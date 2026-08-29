import { assertNever } from '../assert-never.ts'
import { dispatch, getState, subscribe } from '../project/store.ts'
import type { ProjectFile, SaveFailure } from '../project/types.ts'
import {
  DEBOUNCE_MS,
  decideOnStoreChange,
  decideOnWrite,
  hasUnsavedEdits,
  needsFlushOnHide,
  nextDebounceMs,
} from './autosave-decision.ts'
import {
  describeError,
  isPermissionError,
  regrantConnectedDirectory,
  writeProjectFile,
} from './project-directory.ts'

// Module-level rather than closed over by `startAutosave`, because there is exactly one
// store and therefore exactly one autosave — and `retrySave` has to reach this state from the
// failure banner's button without threading a handle through the component tree.
let lastSeenProject: ProjectFile | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let writeInFlight = false
let writeQueued = false
/**
 * When the oldest edit not yet on disk landed, or `null` while the document is clean. Set once
 * per dirty streak — never bumped by a later edit arriving during it — so `nextDebounceMs` can
 * cap the debounce at `MAX_UNSAVED_MS` past the *first* edit of the streak, not the latest.
 */
let oldestUnwrittenEditAt: number | null = null

/** Called once from `main.tsx`. Returns an unsubscribe, so a future teardown has one. */
export function startAutosave(): () => void {
  const unsubscribe = subscribe(onStoreChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('beforeunload', onBeforeUnload)
  onStoreChange()

  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('beforeunload', onBeforeUnload)
    cancelDebounce()
  }
}

/**
 * Writes the pending edit now instead of at the end of the debounce. Two callers: `retrySave`
 * below, and the project switch, which must get the edit into the folder it was made in before
 * the folder changes — entering a non-`ready` state drops the debounce, see `onStoreChange`.
 *
 * Deliberately not `async`: the switch calls it *before* `showDirectoryPicker`, and an await
 * here would spend the transient user activation the picker needs.
 */
export function saveNow(): void {
  cancelDebounce()
  void writeNow()
}

// The browser's own NotAllowedError message ("The request is not allowed by the user agent or
// the platform in the current context") names neither the folder nor the way out, and it is the
// text the failure banner shows.
const PERMISSION_LOST_MESSAGE =
  'NPCanvas no longer has write access to the project folder. Grant it again to save your changes.'
const PERMISSION_REFUSED_MESSAGE =
  'Write access to the project folder was refused. Your changes are still only in this tab.'

/**
 * The save-failure banner's action. Async, but `regrantConnectedDirectory` is deliberately the
 * first await: re-granting a revoked folder permission is a `requestPermission` call, that only
 * prompts under transient user activation, and this runs directly off the button's click.
 */
export async function retrySave(failure: SaveFailure): Promise<void> {
  const state = getState()
  if (failure === 'permission') {
    const granted = await regrantConnectedDirectory()
    // The permission bubble can stand open across a project switch, and reporting this refusal
    // against whatever is open by then would mark a perfectly writable folder as failed. Same
    // guard, same reason as `isStillCurrent` on the write path.
    if (state.kind !== 'ready' || !isStillCurrent(state.project)) return
    if (!granted) {
      dispatch({
        kind: 'save/failed',
        message: PERMISSION_REFUSED_MESSAGE,
        failure: 'permission',
      })
      return
    }
  }
  saveNow()
}

// What each decision *means* lives in `autosave-decision.ts`; this only carries it out.
function onStoreChange(): void {
  const decision = decideOnStoreChange(getState(), lastSeenProject)
  switch (decision.kind) {
    case 'drop':
      cancelDebounce()
      lastSeenProject = null
      oldestUnwrittenEditAt = null
      return

    case 'adopt':
      lastSeenProject = decision.project
      return

    case 'ignore':
      return

    case 'schedule':
      lastSeenProject = decision.project
      oldestUnwrittenEditAt ??= Date.now()
      dispatch({ kind: 'save/pending' })
      scheduleWrite()
      return

    default:
      return assertNever(decision)
  }
}

function scheduleWrite(): void {
  cancelDebounce()
  const waitMs =
    oldestUnwrittenEditAt === null ? DEBOUNCE_MS : nextDebounceMs(oldestUnwrittenEditAt, Date.now())
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void writeNow()
  }, waitMs)
}

function cancelDebounce(): void {
  if (debounceTimer === null) return
  clearTimeout(debounceTimer)
  debounceTimer = null
}

async function writeNow(): Promise<void> {
  const decision = decideOnWrite(getState(), writeInFlight)
  switch (decision.kind) {
    case 'queue':
      writeQueued = true
      return

    case 'skip':
      return

    case 'write':
      await writeProject(decision.project)
      return

    default:
      return assertNever(decision)
  }
}

/** The document decided on, not whatever the store holds when the await resolves. */
async function writeProject(project: ProjectFile): Promise<void> {
  writeInFlight = true
  dispatch({ kind: 'save/saving' })
  try {
    const at = await writeProjectFile(project)
    // Claiming `saved` while a newer document is already queued would be a lie for as long
    // as it takes the follow-up to start.
    if (isStillCurrent(project) && !writeQueued) {
      dispatch({ kind: 'save/saved', at })
      // The document just reached disk, so the streak of unwritten edits this write was for is
      // over — the next edit starts a fresh 800 ms debounce rather than inheriting its deadline.
      oldestUnwrittenEditAt = null
    }
  } catch (error) {
    const permission = isPermissionError(error)
    if (isStillCurrent(project)) {
      dispatch({
        kind: 'save/failed',
        message: permission ? PERMISSION_LOST_MESSAGE : describeError(error),
        failure: permission ? 'permission' : 'write',
      })
    }
  } finally {
    writeInFlight = false
  }

  if (writeQueued) {
    writeQueued = false
    await writeNow()
  }
}

/**
 * Whether the document this write carried is still the one the store holds. The project can
 * be switched during the await, and a `save/saved` landing on the *next* project is the Nav
 * showing "Saved 14:03" for a document nothing has written. A `save/failed` from the previous
 * folder is the same lie in the other direction.
 */
function isStillCurrent(project: ProjectFile): boolean {
  const state = getState()
  return state.kind === 'ready' && state.project === project
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'hidden') return
  // Whether there is an edit no write is carrying yet, not whether a timer happens to be armed:
  // after a failed write there is no timer and the edit is definitely not on disk, which used to
  // mean the one state that most needed this flush was the one state that never got it.
  //
  // A hidden tab can be discarded outright, and `beforeunload` does not fire then. This is the
  // last reliable moment to get the edit onto disk.
  if (!needsFlushOnHide(getState())) return
  cancelDebounce()
  void writeNow()
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedEdits(getState())) return
  // preventDefault() is the specified way; returnValue is what older Chromium still checks.
  // Neither can supply the wording — the browser shows its own generic message.
  event.preventDefault()
  event.returnValue = ''
}

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

// Module-level, not closed over by startAutosave — there's exactly one store and one autosave,
// and retrySave must reach this state from the failure banner's button.
let lastSeenProject: ProjectFile | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let writeInFlight = false
let writeQueued = false
// Set once per dirty streak, never bumped by a later edit, so nextDebounceMs caps the debounce
// at MAX_UNSAVED_MS past the streak's first edit, not its latest.
let oldestUnwrittenEditAt: number | null = null

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

// Not async, deliberately — the project switch calls this before showDirectoryPicker, and an
// await here would spend the transient user activation the picker needs.
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

// regrantConnectedDirectory is deliberately the first await — it's a requestPermission call,
// which only prompts under transient user activation, and this runs off the button's click.
export async function retrySave(failure: SaveFailure): Promise<void> {
  const state = getState()
  if (failure === 'permission') {
    const granted = await regrantConnectedDirectory()
    // The permission bubble can stand open across a project switch — same guard as
    // isStillCurrent on the write path, so a refusal isn't blamed on the wrong folder.
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

async function writeProject(project: ProjectFile): Promise<void> {
  writeInFlight = true
  dispatch({ kind: 'save/saving' })
  try {
    const at = await writeProjectFile(project)
    // Claiming `saved` while a newer document is already queued would be a lie until the
    // follow-up starts.
    if (isStillCurrent(project) && !writeQueued) {
      dispatch({ kind: 'save/saved', at })
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

// The project can be switched mid-await; without this a save/saved could land on the next
// project, showing "Saved 14:03" for a document nothing wrote.
function isStillCurrent(project: ProjectFile): boolean {
  const state = getState()
  return state.kind === 'ready' && state.project === project
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'hidden') return
  // A hidden tab can be discarded outright and beforeunload never fires — this is the last
  // reliable moment to flush an edit no write is carrying yet (including after a failed write,
  // when no debounce timer is armed at all).
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

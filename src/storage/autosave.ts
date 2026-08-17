import { assertNever } from '../assert-never.ts'
import { dispatch, getState, subscribe } from '../project/store.ts'
import type { ProjectFile } from '../project/types.ts'
import { decideOnStoreChange, decideOnWrite } from './autosave-decision.ts'
import { describeError, writeProjectFile } from './project-directory.ts'

// Long enough that a burst of typing is one write, short enough that a user who alt-tabs
// away without triggering `visibilitychange` still loses under a second of work.
const DEBOUNCE_MS = 800

// Module-level rather than closed over by `startAutosave`, because there is exactly one
// store and therefore exactly one autosave — and `retrySave` has to reach this state from
// the Nav's retry button without threading a handle through the component tree.
let lastSeenProject: ProjectFile | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let writeInFlight = false
let writeQueued = false

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
 * Writes the pending edit now instead of at the end of the debounce. Two callers: the Nav's
 * retry button after a `failed` save, and the project switch, which must get the edit into
 * the folder it was made in before the folder changes — entering a non-`ready` state drops
 * the debounce, see `onStoreChange`.
 *
 * Deliberately not `async`: the switch calls it *before* `showDirectoryPicker`, and an await
 * here would spend the transient user activation the picker needs.
 */
export function saveNow(): void {
  cancelDebounce()
  void writeNow()
}

// What each decision *means* lives in `autosave-decision.ts`; this only carries it out.
function onStoreChange(): void {
  const decision = decideOnStoreChange(getState(), lastSeenProject)
  switch (decision.kind) {
    case 'drop':
      cancelDebounce()
      lastSeenProject = null
      return

    case 'adopt':
      lastSeenProject = decision.project
      return

    case 'ignore':
      return

    case 'schedule':
      lastSeenProject = decision.project
      dispatch({ kind: 'save/pending' })
      scheduleWrite()
      return

    default:
      return assertNever(decision)
  }
}

function scheduleWrite(): void {
  cancelDebounce()
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void writeNow()
  }, DEBOUNCE_MS)
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
    if (isStillCurrent(project) && !writeQueued) dispatch({ kind: 'save/saved', at })
  } catch (error) {
    if (isStillCurrent(project)) dispatch({ kind: 'save/failed', message: describeError(error) })
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
  if (debounceTimer === null) return
  // A hidden tab can be discarded outright, and `beforeunload` does not fire then. This is
  // the last reliable moment to get the pending edit onto disk.
  cancelDebounce()
  void writeNow()
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  const state = getState()
  if (state.kind !== 'ready') return
  if (state.save.kind !== 'pending' && state.save.kind !== 'saving') return
  // preventDefault() is the specified way; returnValue is what older Chromium still checks.
  // Neither can supply the wording — the browser shows its own generic message.
  event.preventDefault()
  event.returnValue = ''
}

import { dispatch, getState, subscribe } from '../project/store.ts'
import type { ProjectFile } from '../project/types.ts'
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

function onStoreChange(): void {
  const state = getState()
  if (state.kind !== 'ready') {
    // Disconnected, reconnecting, or reloading: drop the pending write so it cannot land
    // in a folder the user has since left.
    cancelDebounce()
    lastSeenProject = null
    return
  }

  const previous = lastSeenProject
  lastSeenProject = state.project
  // Entering `ready` adopts the freshly loaded document as the baseline instead of marking
  // it dirty: it is already on disk, and writing it back would be a spurious save on every
  // connect. An unchanged reference is every other dispatch — selection, save state — and
  // must not schedule a write either, or the save actions below would loop.
  if (previous === null || previous === state.project) return

  dispatch({ kind: 'save/pending' })
  scheduleWrite()
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
  if (writeInFlight) {
    // At most one follow-up ever queues: it re-reads the current document when it runs, so
    // any number of edits during this write collapse into that single next pass.
    writeQueued = true
    return
  }

  const state = getState()
  if (state.kind !== 'ready') return

  writeInFlight = true
  dispatch({ kind: 'save/saving' })
  try {
    const at = await writeProjectFile(state.project)
    // Claiming `saved` while a newer document is already queued would be a lie for as long
    // as it takes the follow-up to start.
    if (!writeQueued) dispatch({ kind: 'save/saved', at })
  } catch (error) {
    dispatch({ kind: 'save/failed', message: describeError(error) })
  } finally {
    writeInFlight = false
  }

  if (writeQueued) {
    writeQueued = false
    await writeNow()
  }
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

import { useSyncExternalStore } from 'react'
import type { AppState, Dialogue, DialogueId, SaveState } from './types.ts'
import type { Action } from './reducer.ts'
import { reduce } from './reducer.ts'

let state: AppState = { kind: 'disconnected' }
const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Whether a notify pass is running, and what to run after it. Autosave's listener dispatches
 * `save/pending` synchronously, so without this every document edit would run a **nested**
 * notify inside the outer one: listeners registered before autosave would see the old state
 * and listeners after it the newer one, and React's callback would fire twice per edit.
 */
let notifying = false
const queued: Action[] = []

export function dispatch(action: Action): void {
  if (notifying) {
    queued.push(action)
    return
  }
  apply(action)
  // A queued action can queue another; the loop is what keeps the chain flat instead of deep.
  for (let next = queued.shift(); next !== undefined; next = queued.shift()) apply(next)
}

function apply(action: Action): void {
  const next = reduce(state, action)
  if (next === state) return
  state = next
  notifying = true
  try {
    // A snapshot of the set, so subscribing or unsubscribing from inside a listener cannot
    // change who this pass visits: every listener is notified exactly once per change.
    for (const listener of [...listeners]) listener()
  } finally {
    notifying = false
  }
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState)
}

/**
 * The state as everything except the save indicator sees it.
 *
 * A save cycle is three states in under a second — pending, saving, saved — and a subscriber
 * to the whole state re-renders three times per edit for a change only the Nav is showing. This
 * hands back the *previous* state object whenever `save` is the only field that moved, so
 * `useSyncExternalStore`'s `Object.is` check bails and the canvas stands still.
 *
 * The store is still one `AppState`, which CLAUDE.md fixes; this is a selector over it. The
 * name is the warning: the `save` field of what this returns is stale by design. Read it
 * through `useSaveState` instead — `Nav` and the failure banner do.
 */
export function useAppStateExceptSave(): AppState {
  return useSyncExternalStore(subscribe, getStateExceptSave)
}

let lastExceptSave: AppState = state

function getStateExceptSave(): AppState {
  if (state !== lastExceptSave && !onlySaveChanged(lastExceptSave, state)) lastExceptSave = state
  return lastExceptSave
}

function onlySaveChanged(before: AppState, after: AppState): boolean {
  return (
    before.kind === 'ready' &&
    after.kind === 'ready' &&
    before.project === after.project &&
    before.selection === after.selection &&
    before.repairs === after.repairs &&
    before.directoryName === after.directoryName
  )
}

/** The save state on its own subscription. `null` before a project is open. */
export function useSaveState(): SaveState | null {
  return useSyncExternalStore(subscribe, getSaveState)
}

function getSaveState(): SaveState | null {
  return state.kind === 'ready' ? state.save : null
}

/**
 * The dialogue as the document holds it *now*, or null once it is gone.
 *
 * For work that resumes after an await: a component's `dialogue` prop is the render the work
 * started in, and a dispatch naming a deleted dialogue is a no-op the reducer performs
 * silently. Anything that wrote a file before dispatching has to ask.
 */
export function currentDialogue(dialogueId: DialogueId): Dialogue | null {
  if (state.kind !== 'ready') return null
  return state.project.dialogues.find((one) => one.id === dialogueId) ?? null
}

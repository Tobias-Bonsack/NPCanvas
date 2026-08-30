import { useSyncExternalStore } from 'react'
import type { AppState, Dialogue, DialogueId, History, SaveState } from './types.ts'
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

// dispatch never nests: a dispatch arriving during a notify pass is queued and run after it,
// over a snapshot of the listener set taken when that pass started — this is what keeps
// autosave's synchronous save/pending dispatch from firing a listener twice per edit.
let notifying = false
const queued: Action[] = []

export function dispatch(action: Action): void {
  if (notifying) {
    queued.push(action)
    return
  }
  apply(action)
  for (let next = queued.shift(); next !== undefined; next = queued.shift()) apply(next)
}

function apply(action: Action): void {
  const next = reduce(state, action)
  if (next === state) return
  state = next
  notifying = true
  try {
    for (const listener of [...listeners]) listener()
  } finally {
    notifying = false
  }
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState)
}

// A selector: hands back the previous state object whenever `save` is the only field that
// moved, so useSyncExternalStore's Object.is check bails and a save cycle (pending/saving/saved)
// doesn't re-render subscribers who only care about the document. Its own `save` field is
// therefore stale by design — read that through useSaveState instead.
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

export function useSaveState(): SaveState | null {
  return useSyncExternalStore(subscribe, getSaveState)
}

function getSaveState(): SaveState | null {
  return state.kind === 'ready' ? state.save : null
}

// useSyncExternalStore requires a stable snapshot, so this returns the `history` field itself
// rather than deriving canUndo/canRedo into a fresh object on every call.
export function useHistoryState(): History | null {
  return useSyncExternalStore(subscribe, getHistoryState)
}

function getHistoryState(): History | null {
  return state.kind === 'ready' ? state.history : null
}

// For work resuming after an await: a component's `dialogue` prop is the render it started in,
// so anything that wrote a file before dispatching has to ask what the document holds now.
export function currentDialogue(dialogueId: DialogueId): Dialogue | null {
  if (state.kind !== 'ready') return null
  return state.project.dialogues.find((one) => one.id === dialogueId) ?? null
}

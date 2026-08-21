import { useSyncExternalStore } from 'react'
import type { AppState, Dialogue, DialogueId } from './types.ts'
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

export function dispatch(action: Action): void {
  const next = reduce(state, action)
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState)
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

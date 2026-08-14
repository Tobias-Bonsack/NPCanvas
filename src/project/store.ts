import { useSyncExternalStore } from 'react'
import type { AppState } from './types.ts'
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

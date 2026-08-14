import { assertNever } from '../assert-never.ts'
import type { AppState, ProjectFile, SaveState, Selection } from './types.ts'

export type Action =
  | { kind: 'project/unsupported' }
  | { kind: 'project/disconnected' }
  | { kind: 'project/reconnecting'; directoryName: string }
  | { kind: 'project/loading'; directoryName: string }
  | { kind: 'project/loaded'; directoryName: string; project: ProjectFile }
  | { kind: 'project/load-failed'; directoryName: string; message: string }
  | { kind: 'save/pending' }
  | { kind: 'save/saving' }
  | { kind: 'save/saved'; at: string }
  | { kind: 'save/failed'; message: string }
  | { kind: 'selection/set'; selection: Selection }

/**
 * Pure. Returns the *same* reference for a no-op, which is how `dispatch` skips notifying
 * subscribers. Never throws: async IO in storage/ dispatches steps that may land after the
 * state has already moved on, and a reducer crash there would take the whole app down.
 */
export function reduce(state: AppState, action: Action): AppState {
  switch (action.kind) {
    case 'project/unsupported':
      return state.kind === 'unsupported' ? state : { kind: 'unsupported' }

    case 'project/disconnected':
      return state.kind === 'disconnected' ? state : { kind: 'disconnected' }

    case 'project/reconnecting':
      return { kind: 'reconnecting', directoryName: action.directoryName }

    case 'project/loading':
      return { kind: 'loading', directoryName: action.directoryName }

    case 'project/loaded':
      return {
        kind: 'ready',
        directoryName: action.directoryName,
        project: action.project,
        // Freshly read from disk, so the document and the file agree as of `savedAt`.
        save: { kind: 'saved', at: action.project.savedAt },
        selection: { kind: 'none' },
      }

    case 'project/load-failed':
      return {
        kind: 'load-failed',
        directoryName: action.directoryName,
        message: action.message,
      }

    case 'save/pending':
      return withSaveState(state, { kind: 'pending' })

    case 'save/saving':
      return withSaveState(state, { kind: 'saving' })

    case 'save/saved':
      return withSaveState(state, { kind: 'saved', at: action.at })

    case 'save/failed':
      return withSaveState(state, { kind: 'failed', message: action.message })

    case 'selection/set': {
      if (state.kind !== 'ready') return state
      if (isSameSelection(state.selection, action.selection)) return state
      return { ...state, selection: action.selection }
    }

    default:
      return assertNever(action)
  }
}

/**
 * Autosave subscribes to the store, so a save action that changed nothing must return the
 * identical state — otherwise marking a save "pending" would wake autosave, which would
 * mark it pending again.
 */
function withSaveState(state: AppState, save: SaveState): AppState {
  if (state.kind !== 'ready') return state
  if (isSameSaveState(state.save, save)) return state
  return { ...state, save }
}

function isSameSaveState(a: SaveState, b: SaveState): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'saved' && b.kind === 'saved') return a.at === b.at
  if (a.kind === 'failed' && b.kind === 'failed') return a.message === b.message
  return true
}

function isSameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'none' || b.kind === 'none' || a.id === b.id
}

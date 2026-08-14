import { assertNever } from '../assert-never.ts'
import type { AppState, ProjectFile, Selection } from './types.ts'

export type Action =
  | { kind: 'project/unsupported' }
  | { kind: 'project/disconnected' }
  | { kind: 'project/reconnecting'; directoryName: string }
  | { kind: 'project/loading'; directoryName: string }
  | { kind: 'project/loaded'; directoryName: string; project: ProjectFile }
  | { kind: 'project/load-failed'; directoryName: string; message: string }
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

    case 'selection/set': {
      if (state.kind !== 'ready') return state
      if (isSameSelection(state.selection, action.selection)) return state
      return { ...state, selection: action.selection }
    }

    default:
      return assertNever(action)
  }
}

function isSameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'none' || b.kind === 'none' || a.id === b.id
}

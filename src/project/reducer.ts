import { assertNever } from '../assert-never.ts'
import type {
  AppState,
  DialogueId,
  GameMap,
  MapId,
  ProjectFile,
  SaveState,
  Selection,
  ZoneId,
} from './types.ts'

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
  | { kind: 'map/added'; map: GameMap }
  | { kind: 'map/renamed'; mapId: MapId; name: string }
  | { kind: 'map/deleted'; mapId: MapId }

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

    case 'map/added': {
      if (state.kind !== 'ready') return state
      return {
        ...state,
        project: { ...state.project, maps: [...state.project.maps, action.map] },
      }
    }

    case 'map/renamed': {
      if (state.kind !== 'ready') return state
      const target = state.project.maps.find((map) => map.id === action.mapId)
      if (target === undefined || target.name === action.name) return state
      return {
        ...state,
        project: {
          ...state.project,
          maps: state.project.maps.map((map) =>
            map === target ? { ...map, name: action.name } : map,
          ),
        },
      }
    }

    // The whole cascade is one action: a map, its zones, its dialogues, and every quest
    // reference to those dialogues move together. Split across several dispatches, autosave
    // would write an intermediate document in which quests point at dialogues that no
    // longer exist.
    case 'map/deleted': {
      if (state.kind !== 'ready') return state
      const { project } = state
      if (!project.maps.some((map) => map.id === action.mapId)) return state

      const removedDialogueIds = new Set<DialogueId>()
      for (const dialogue of project.dialogues) {
        if (dialogue.mapId === action.mapId) removedDialogueIds.add(dialogue.id)
      }
      const removedZoneIds = new Set<ZoneId>()
      for (const zone of project.zones) {
        if (zone.mapId === action.mapId) removedZoneIds.add(zone.id)
      }

      return {
        ...state,
        project: {
          ...project,
          maps: project.maps.filter((map) => map.id !== action.mapId),
          zones: project.zones.filter((zone) => !removedZoneIds.has(zone.id)),
          dialogues: project.dialogues.filter((dialogue) => !removedDialogueIds.has(dialogue.id)),
          // Quests are not scoped to a map, so they survive — but a dangling DialogueId in
          // one is a reference to nothing that every later reader would have to defend
          // against. Pruned here, at the only place that can create one.
          quests: project.quests.map((quest) =>
            quest.dialogueIds.some((id) => removedDialogueIds.has(id))
              ? {
                  ...quest,
                  dialogueIds: quest.dialogueIds.filter((id) => !removedDialogueIds.has(id)),
                }
              : quest,
          ),
        },
        selection: dropDeletedSelection(state.selection, removedDialogueIds, removedZoneIds),
      }
    }

    default:
      return assertNever(action)
  }
}

/** A selection pointing at a deleted entity would render as a detail panel for nothing. */
function dropDeletedSelection(
  selection: Selection,
  removedDialogueIds: ReadonlySet<DialogueId>,
  removedZoneIds: ReadonlySet<ZoneId>,
): Selection {
  switch (selection.kind) {
    case 'none':
      return selection
    case 'dialogue':
      return removedDialogueIds.has(selection.id) ? { kind: 'none' } : selection
    case 'zone':
      return removedZoneIds.has(selection.id) ? { kind: 'none' } : selection
    default:
      return assertNever(selection)
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

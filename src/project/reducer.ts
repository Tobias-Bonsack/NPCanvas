import { assertNever } from '../assert-never.ts'
import { clampMapScale, originForScale } from '../map/canvas-layout.ts'
import type {
  AppState,
  Dialogue,
  DialogueId,
  GameMap,
  MapId,
  Point,
  ProjectFile,
  Quest,
  RelevanceTag,
  SaveState,
  Selection,
  ZoneId,
} from './types.ts'
import { RELEVANCE_TAGS } from './types.ts'

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
  | { kind: 'map/moved'; mapId: MapId; origin: Point }
  | { kind: 'map/scaled'; mapId: MapId; scale: number }
  | { kind: 'map/deleted'; mapId: MapId }
  | { kind: 'dialogue/added'; dialogue: Dialogue }
  | { kind: 'dialogue/moved'; dialogueId: DialogueId; position: Point }
  | { kind: 'dialogue/npc-named'; dialogueId: DialogueId; npcName: string }
  | { kind: 'dialogue/text-set'; dialogueId: DialogueId; text: string }
  | { kind: 'dialogue/spoken-at-set'; dialogueId: DialogueId; spokenAt: string }
  | { kind: 'dialogue/relevance-set'; dialogueId: DialogueId; relevance: readonly RelevanceTag[] }
  | { kind: 'dialogue/deleted'; dialogueId: DialogueId }

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
      return withMap(state, target, { ...target, name: action.name })
    }

    // Fires once per drag, on pointerup, for the same reason `dialogue/moved` does: the map
    // follows the cursor from component state, so autosave sees one document change.
    case 'map/moved': {
      if (state.kind !== 'ready') return state
      const target = state.project.maps.find((map) => map.id === action.mapId)
      if (target === undefined) return state
      if (target.origin.x === action.origin.x && target.origin.y === action.origin.y) return state
      return withMap(state, target, { ...target, origin: action.origin })
    }

    // The origin moves with the scale so the map's centre stays put — the two are one
    // adjustment, and splitting them would let a caller apply half of it.
    case 'map/scaled': {
      if (state.kind !== 'ready') return state
      const target = state.project.maps.find((map) => map.id === action.mapId)
      if (target === undefined) return state
      const scale = clampMapScale(action.scale)
      if (target.scale === scale) return state
      return withMap(state, target, { ...target, scale, origin: originForScale(target, scale) })
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
          quests: pruneQuestDialogues(project.quests, removedDialogueIds),
        },
        selection: dropDeletedSelection(state.selection, {
          dialogues: removedDialogueIds,
          zones: removedZoneIds,
          maps: new Set([action.mapId]),
        }),
      }
    }

    case 'dialogue/added': {
      if (state.kind !== 'ready') return state
      return {
        ...state,
        project: {
          ...state.project,
          dialogues: [...state.project.dialogues, action.dialogue],
        },
      }
    }

    // Fires once per drag, on pointerup — not per pointermove. The dragged pin follows the
    // cursor from PinLayer's own state, so autosave sees one document change, not sixty.
    case 'dialogue/moved': {
      if (state.kind !== 'ready') return state
      const target = state.project.dialogues.find((dialogue) => dialogue.id === action.dialogueId)
      if (target === undefined) return state
      if (target.position.x === action.position.x && target.position.y === action.position.y) {
        return state
      }
      return withDialogue(state, target, { ...target, position: action.position })
    }

    // The four field edits below each fire per keystroke or per click. They are separate
    // actions rather than one patch so every one of them can compare its own field and
    // return the identical state for a no-op — which is what keeps autosave from waking on
    // a re-render that changed nothing.
    case 'dialogue/npc-named': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null || target.npcName === action.npcName) return state
      return withDialogue(state, target, { ...target, npcName: action.npcName })
    }

    // Only meaningful for a text dialogue: media content has no text body, and inventing one
    // would discard the file reference.
    case 'dialogue/text-set': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null || target.content.kind !== 'text') return state
      if (target.content.text === action.text) return state
      return withDialogue(state, target, {
        ...target,
        content: { kind: 'text', text: action.text },
      })
    }

    case 'dialogue/spoken-at-set': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null || target.spokenAt === action.spokenAt) return state
      return withDialogue(state, target, { ...target, spokenAt: action.spokenAt })
    }

    case 'dialogue/relevance-set': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null) return state
      const relevance = normalizeRelevance(action.relevance)
      if (isSameRelevance(target.relevance, relevance)) return state
      return withDialogue(state, target, { ...target, relevance })
    }

    case 'dialogue/deleted': {
      if (state.kind !== 'ready') return state
      const { project } = state
      if (!project.dialogues.some((dialogue) => dialogue.id === action.dialogueId)) return state

      const removed = new Set<DialogueId>([action.dialogueId])
      return {
        ...state,
        project: {
          ...project,
          dialogues: project.dialogues.filter((dialogue) => dialogue.id !== action.dialogueId),
          quests: pruneQuestDialogues(project.quests, removed),
        },
        selection: dropDeletedSelection(state.selection, {
          dialogues: removed,
          zones: EMPTY_ZONE_IDS,
          maps: EMPTY_MAP_IDS,
        }),
      }
    }

    default:
      return assertNever(action)
  }
}

const EMPTY_ZONE_IDS: ReadonlySet<ZoneId> = new Set<ZoneId>()
const EMPTY_MAP_IDS: ReadonlySet<MapId> = new Set<MapId>()

type ReadyState = Extract<AppState, { kind: 'ready' }>

/** Replaces one map by reference identity. Every single-map edit funnels through here. */
function withMap(state: ReadyState, target: GameMap, replacement: GameMap): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      maps: state.project.maps.map((map) => (map === target ? replacement : map)),
    },
  }
}

/** Replaces one dialogue by reference identity, mirroring `withMap`. */
function withDialogue(state: ReadyState, target: Dialogue, replacement: Dialogue): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      dialogues: state.project.dialogues.map((dialogue) =>
        dialogue === target ? replacement : dialogue,
      ),
    },
  }
}

function findDialogue(project: ProjectFile, id: DialogueId): Dialogue | null {
  return project.dialogues.find((dialogue) => dialogue.id === id) ?? null
}

/**
 * Deduplicated and in `RELEVANCE_TAGS` order, whatever order the checkboxes were clicked in.
 * The declaration order is the canonical one, so `data.json` stays stable and diffable —
 * toggling a tag off and on again must not reshuffle the array and produce a spurious write.
 */
function normalizeRelevance(tags: readonly RelevanceTag[]): RelevanceTag[] {
  const chosen = new Set(tags)
  return RELEVANCE_TAGS.filter((tag) => chosen.has(tag))
}

/** Both sides are already normalized, so element-wise equality is enough. */
function isSameRelevance(a: readonly RelevanceTag[], b: readonly RelevanceTag[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}

/**
 * Quests are not scoped to a map, so they outlive any cascade — but a dangling `DialogueId`
 * in one is a reference to nothing that every later reader would have to defend against.
 * Pruned at the only two places that can create one.
 */
function pruneQuestDialogues(quests: Quest[], removed: ReadonlySet<DialogueId>): Quest[] {
  return quests.map((quest) =>
    quest.dialogueIds.some((id) => removed.has(id))
      ? { ...quest, dialogueIds: quest.dialogueIds.filter((id) => !removed.has(id)) }
      : quest,
  )
}

/** Everything one cascade took out, by kind — the input to `dropDeletedSelection`. */
type RemovedIds = {
  dialogues: ReadonlySet<DialogueId>
  zones: ReadonlySet<ZoneId>
  maps: ReadonlySet<MapId>
}

/** A selection pointing at a deleted entity would render as a detail panel for nothing. */
function dropDeletedSelection(selection: Selection, removed: RemovedIds): Selection {
  switch (selection.kind) {
    case 'none':
      return selection
    case 'dialogue':
      return removed.dialogues.has(selection.id) ? { kind: 'none' } : selection
    case 'zone':
      return removed.zones.has(selection.id) ? { kind: 'none' } : selection
    case 'map':
      return removed.maps.has(selection.id) ? { kind: 'none' } : selection
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

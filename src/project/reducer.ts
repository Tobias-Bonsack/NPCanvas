import { assertNever } from '../assert-never.ts'
import type { ProfileCalibration } from '../capture/capture-profile.ts'
import { forgetGlyph, mergeGlyphs } from '../capture/glyph-matcher.ts'
import { clampMapScale, originForScale } from '../map/canvas-layout.ts'
import { isSamePolygon } from '../map/geometry.ts'
import type {
  AppState,
  CaptureProfile,
  CaptureProfileId,
  Dialogue,
  DialogueId,
  DialogueMedia,
  GameMap,
  Glyph,
  History,
  MapId,
  MediaId,
  Point,
  Polygon,
  ProjectFile,
  ProjectRepairs,
  Quest,
  QuestId,
  RelevanceTag,
  RelevanceTagId,
  SaveFailure,
  SaveState,
  Selection,
  Zone,
  ZoneId,
} from './types.ts'

export type Action =
  | { kind: 'project/unsupported' }
  | { kind: 'project/disconnected' }
  | { kind: 'project/pick-cancelled' }
  | { kind: 'project/reconnecting'; directoryName: string }
  | { kind: 'project/loading'; directoryName: string }
  | { kind: 'project/loaded'; directoryName: string; project: ProjectFile; repairs: ProjectRepairs }
  | { kind: 'project/load-failed'; directoryName: string; message: string }
  | { kind: 'save/pending' }
  | { kind: 'save/saving' }
  | { kind: 'save/saved'; at: string }
  | { kind: 'save/failed'; message: string; failure: SaveFailure }
  | { kind: 'selection/set'; selection: Selection }
  | { kind: 'map/added'; map: GameMap }
  | { kind: 'map/renamed'; mapId: MapId; name: string }
  | { kind: 'map/moved'; mapId: MapId; origin: Point }
  | { kind: 'map/scaled'; mapId: MapId; scale: number }
  | { kind: 'map/deleted'; mapId: MapId }
  | { kind: 'zone/added'; zone: Zone }
  | { kind: 'zone/renamed'; zoneId: ZoneId; name: string }
  | { kind: 'zone/hue-set'; zoneId: ZoneId; hue: number }
  | { kind: 'zone/reshaped'; zoneId: ZoneId; polygon: Polygon }
  | { kind: 'zone/deleted'; zoneId: ZoneId }
  | { kind: 'dialogue/added'; dialogue: Dialogue }
  | { kind: 'dialogue/moved'; dialogueId: DialogueId; position: Point }
  | { kind: 'dialogue/npc-named'; dialogueId: DialogueId; npcName: string }
  | { kind: 'npc/renamed'; from: string; to: string }
  | { kind: 'dialogue/text-set'; dialogueId: DialogueId; text: string }
  | { kind: 'dialogue/media-added'; dialogueId: DialogueId; media: DialogueMedia }
  | { kind: 'dialogue/media-removed'; dialogueId: DialogueId; mediaId: MediaId }
  | { kind: 'dialogue/media-reordered'; dialogueId: DialogueId; mediaId: MediaId; toIndex: number }
  | { kind: 'dialogue/spoken-at-set'; dialogueId: DialogueId; spokenAt: string }
  | { kind: 'dialogue/relevance-set'; dialogueId: DialogueId; relevance: readonly RelevanceTagId[] }
  | { kind: 'dialogue/deleted'; dialogueId: DialogueId }
  | { kind: 'quest/added'; quest: Quest }
  | { kind: 'quest/renamed'; questId: QuestId; name: string }
  | { kind: 'quest/note-set'; questId: QuestId; note: string }
  | { kind: 'quest/hue-set'; questId: QuestId; hue: number }
  | { kind: 'quest/status-set'; questId: QuestId; status: Quest['status'] }
  | { kind: 'quest/dialogue-attached'; questId: QuestId; dialogueId: DialogueId }
  | { kind: 'quest/dialogue-detached'; questId: QuestId; dialogueId: DialogueId }
  | { kind: 'quest/deleted'; questId: QuestId }
  | { kind: 'capture-profile/added'; profile: CaptureProfile }
  | { kind: 'capture-profile/renamed'; profileId: CaptureProfileId; name: string }
  | {
      kind: 'capture-profile/calibrated'
      profileId: CaptureProfileId
      calibration: ProfileCalibration
    }
  | { kind: 'capture-profile/deleted'; profileId: CaptureProfileId }
  | { kind: 'glyphs/learned'; glyphs: readonly Glyph[] }
  | { kind: 'glyph/forgotten'; bits: string }
  | { kind: 'relevance-tag/added'; tag: RelevanceTag }
  | { kind: 'relevance-tag/renamed'; tagId: RelevanceTagId; name: string }
  | { kind: 'relevance-tag/hue-set'; tagId: RelevanceTagId; hue: number }
  | { kind: 'relevance-tag/reordered'; tagId: RelevanceTagId; toIndex: number }
  | { kind: 'relevance-tag/deleted'; tagId: RelevanceTagId }
  | { kind: 'history/undo' }
  | { kind: 'history/redo' }

/**
 * Pure. Returns the *same* reference for a no-op, which is how `dispatch` skips notifying
 * subscribers. Never throws: async IO in storage/ dispatches steps that may land after the
 * state has already moved on, and a reducer crash there would take the whole app down.
 *
 * History bookkeeping is layered on top of `applyAction` rather than folded into its switch:
 * every case there already returns a fresh `project` reference for a real change and the
 * identical one for a no-op, which is exactly the signal history needs, so one generic wrapper
 * covers all of them instead of forty repeated pushes.
 */
export function reduce(state: AppState, action: Action): AppState {
  const next = applyAction(state, action)
  if (next === state) return next
  return trackHistory(state, next, action)
}

function applyAction(state: AppState, action: Action): AppState {
  switch (action.kind) {
    case 'project/unsupported':
      return state.kind === 'unsupported' ? state : { kind: 'unsupported' }

    case 'project/disconnected':
      return state.kind === 'disconnected' ? state : { kind: 'disconnected' }

    // Closing the folder picker means only that no folder was chosen. What follows from that
    // depends on what there was to keep: a project already open stays open, and anywhere else
    // there is nothing to fall back to but `disconnected`.
    case 'project/pick-cancelled':
      if (state.kind === 'ready') return state
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
        repairs: action.repairs,
        // Freshly read from disk, so the document and the file agree as of `savedAt`.
        save: { kind: 'saved', at: action.project.savedAt },
        selection: { kind: 'none' },
        // Undoing across a project switch must be impossible: a step here would land the
        // document holding one project back into the state of a different one.
        history: EMPTY_HISTORY,
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
      return withSaveState(state, {
        kind: 'failed',
        message: action.message,
        failure: action.failure,
      })

    case 'selection/set': {
      if (state.kind !== 'ready') return state
      if (isSameSelection(state.selection, action.selection)) return state
      return { ...state, selection: action.selection }
    }

    // An id already in the document would make identity ambiguous everywhere at once —
    // `withMap` replaces by reference, a delete removes both, React renders two nodes under one
    // key. Unreachable through the UI (ids are UUIDs), and guarded for the same reason
    // `quest/dialogue-attached` is: parse and the reducer are the only two doors into the
    // document, and an invariant enforced on one of them is not enforced.
    case 'map/added': {
      if (state.kind !== 'ready') return state
      if (state.project.maps.some((map) => map.id === action.map.id)) return state
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
      if (!hasMap(project, action.mapId)) return state

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

    // The map must exist, for the same reason `dialogue/added` requires one: a zone on a
    // missing map renders nowhere, lists nowhere, and is written back on every save.
    case 'zone/added': {
      if (state.kind !== 'ready') return state
      if (!hasMap(state.project, action.zone.mapId)) return state
      return {
        ...state,
        project: { ...state.project, zones: [...state.project.zones, action.zone] },
      }
    }

    case 'zone/renamed': {
      if (state.kind !== 'ready') return state
      const target = findZone(state.project, action.zoneId)
      if (target === null || target.name === action.name) return state
      return withZone(state, target, { ...target, name: action.name })
    }

    case 'zone/hue-set': {
      if (state.kind !== 'ready') return state
      const target = findZone(state.project, action.zoneId)
      if (target === null || target.hue === action.hue) return state
      return withZone(state, target, { ...target, hue: action.hue })
    }

    // One action for both zone gestures — a move and a resize each hand over the polygon they
    // ended on, and a zone is nothing but its polygon. Fires once per drag, on pointerup, like
    // `map/moved` and `dialogue/moved`. Nothing here touches a `Dialogue`: which zone a
    // dialogue is in is derived from the geometry on every read, so reshaping a zone
    // reclassifies its contents with zero writes. See CLAUDE.md.
    case 'zone/reshaped': {
      if (state.kind !== 'ready') return state
      const target = findZone(state.project, action.zoneId)
      if (target === null || isSamePolygon(target.polygon, action.polygon)) return state
      return withZone(state, target, { ...target, polygon: action.polygon })
    }

    // No cascade, deliberately: a zone owns nothing. Dialogues inside it merely stop deriving
    // a location from it, which is the point of never storing the association.
    case 'zone/deleted': {
      if (state.kind !== 'ready') return state
      const { project } = state
      if (!project.zones.some((zone) => zone.id === action.zoneId)) return state

      const removed = new Set<ZoneId>([action.zoneId])
      return {
        ...state,
        project: {
          ...project,
          zones: project.zones.filter((zone) => zone.id !== action.zoneId),
        },
        selection: dropDeletedSelection(state.selection, {
          dialogues: EMPTY_DIALOGUE_IDS,
          zones: removed,
          maps: EMPTY_MAP_IDS,
        }),
      }
    }

    // The map must exist. A dialogue on a missing map is invisible and undeletable:
    // `groupByMap` drops it from the canvas, so the one place `dialogue/deleted` is dispatched
    // from — its pin — never renders, while Insights still counts it and every save writes it
    // back. `repairReferences` closes the same hole on the other door, at parse.
    case 'dialogue/added': {
      if (state.kind !== 'ready') return state
      if (!hasMap(state.project, action.dialogue.mapId)) return state
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

    /**
     * An NPC is not an entity — there is no `Npc` record, only a name repeated on every line
     * they said. So "rename this NPC" is one action over the whole document rather than a loop
     * of `dialogue/npc-named` from a component: a loop would write a document per line, and
     * autosave would persist a project half-way through the rename.
     *
     * Matching is on the *trimmed* name, which is the identity the insights view groups by
     * (`npcKey`). Exact otherwise: 'Mara' leaves 'mara' and 'Mara the Elder' alone.
     *
     * Renaming onto a name that already exists **merges** the two — the lines simply end up
     * carrying one name. That is the correct outcome for the case this exists for (a typo
     * discovered fifty lines later), so it is stated rather than stumbled into.
     */
    case 'npc/renamed': {
      if (state.kind !== 'ready') return state
      const from = action.from.trim()
      const to = action.to.trim()
      if (from === to) return state
      const dialogues = state.project.dialogues.map((dialogue) =>
        dialogue.npcName.trim() === from ? { ...dialogue, npcName: to } : dialogue,
      )
      if (dialogues.every((dialogue, index) => dialogue === state.project.dialogues[index])) {
        return state
      }
      return { ...state, project: { ...state.project, dialogues } }
    }

    // Unconditional: what was said and what proves it are separate fields, so a dialogue that
    // already carries pictures still has a line to edit — and a capture appends both.
    case 'dialogue/text-set': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null || target.text === action.text) return state
      return withDialogue(state, target, { ...target, text: action.text })
    }

    // Appended, never replacing: several frames of one line is the case the list exists for.
    case 'dialogue/media-added': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null) return state
      return withDialogue(state, target, { ...target, media: [...target.media, action.media] })
    }

    // Deleting the file the medium referenced is the caller's job: it is IO, and IO never
    // enters the reducer.
    case 'dialogue/media-removed': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null || !target.media.some((medium) => medium.id === action.mediaId)) {
        return state
      }
      return withDialogue(state, target, {
        ...target,
        media: target.media.filter((medium) => medium.id !== action.mediaId),
      })
    }

    // Moves one medium to a position, rather than taking a whole order: an order supplied from
    // outside could drop an id, and a list that loses a picture on a drag is a lost file.
    case 'dialogue/media-reordered': {
      if (state.kind !== 'ready') return state
      const target = findDialogue(state.project, action.dialogueId)
      if (target === null) return state
      const media = moveMedium(target.media, action.mediaId, action.toIndex)
      if (media === null) return state
      return withDialogue(state, target, { ...target, media })
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
      const relevance = normalizeRelevance(action.relevance, state.project.relevanceTags)
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

    case 'quest/added': {
      if (state.kind !== 'ready') return state
      return {
        ...state,
        project: { ...state.project, quests: [...state.project.quests, action.quest] },
      }
    }

    case 'quest/renamed': {
      if (state.kind !== 'ready') return state
      const target = findQuest(state.project, action.questId)
      if (target === null || target.name === action.name) return state
      return withQuest(state, target, { ...target, name: action.name })
    }

    case 'quest/note-set': {
      if (state.kind !== 'ready') return state
      const target = findQuest(state.project, action.questId)
      if (target === null || target.note === action.note) return state
      return withQuest(state, target, { ...target, note: action.note })
    }

    case 'quest/hue-set': {
      if (state.kind !== 'ready') return state
      const target = findQuest(state.project, action.questId)
      if (target === null || target.hue === action.hue) return state
      return withQuest(state, target, { ...target, hue: action.hue })
    }

    case 'quest/status-set': {
      if (state.kind !== 'ready') return state
      const target = findQuest(state.project, action.questId)
      if (target === null || target.status === action.status) return state
      return withQuest(state, target, { ...target, status: action.status })
    }

    // The dialogue must exist. `pruneQuestDialogues` guarantees no dangling id survives a
    // deletion, and this is the only other way one could enter the document — so the two
    // together are what let every reader treat a `dialogueIds` entry as resolvable.
    case 'quest/dialogue-attached': {
      if (state.kind !== 'ready') return state
      const target = findQuest(state.project, action.questId)
      if (target === null || target.dialogueIds.includes(action.dialogueId)) return state
      if (findDialogue(state.project, action.dialogueId) === null) return state
      return withQuest(state, target, {
        ...target,
        dialogueIds: [...target.dialogueIds, action.dialogueId],
      })
    }

    case 'quest/dialogue-detached': {
      if (state.kind !== 'ready') return state
      const target = findQuest(state.project, action.questId)
      if (target === null || !target.dialogueIds.includes(action.dialogueId)) return state
      return withQuest(state, target, {
        ...target,
        dialogueIds: target.dialogueIds.filter((id) => id !== action.dialogueId),
      })
    }

    // No cascade, and deliberately none: a quest *references* dialogues, it does not own them.
    // Deleting the thread the user was following must never delete the lines it collected.
    case 'quest/deleted': {
      if (state.kind !== 'ready') return state
      const { project } = state
      if (!project.quests.some((quest) => quest.id === action.questId)) return state
      return {
        ...state,
        project: {
          ...project,
          quests: project.quests.filter((quest) => quest.id !== action.questId),
        },
      }
    }

    case 'capture-profile/added': {
      if (state.kind !== 'ready') return state
      return {
        ...state,
        project: {
          ...state.project,
          captureProfiles: [...state.project.captureProfiles, action.profile],
        },
      }
    }

    case 'capture-profile/renamed': {
      if (state.kind !== 'ready') return state
      const target = findCaptureProfile(state.project, action.profileId)
      if (target === null || target.name === action.name) return state
      return withCaptureProfile(state, target, { ...target, name: action.name })
    }

    case 'capture-profile/calibrated': {
      if (state.kind !== 'ready') return state
      const target = findCaptureProfile(state.project, action.profileId)
      if (target === null) return state
      return withCaptureProfile(state, target, { ...target, ...action.calibration })
    }

    // No cascade: a profile is how pixels were read, not something the document references.
    // Which profile is active is transient UI state and never enters the store, so there is
    // nothing here to clear either. The alphabet is the project's, so deleting a profile does
    // not cost it — which is why the confirmation no longer warns about the glyphs.
    case 'capture-profile/deleted': {
      if (state.kind !== 'ready') return state
      const { project } = state
      if (!project.captureProfiles.some((profile) => profile.id === action.profileId)) return state
      return {
        ...state,
        project: {
          ...project,
          captureProfiles: project.captureProfiles.filter(
            (profile) => profile.id !== action.profileId,
          ),
        },
      }
    }

    // The alphabet belongs to the project, not to whichever profile happened to be aimed at the
    // box when a tile was typed in — see CLAUDE.md. `mergeGlyphs` is the only addition path, and
    // it replaces on identical bits, so re-learning a tile corrects it.
    case 'glyphs/learned': {
      if (state.kind !== 'ready') return state
      if (action.glyphs.length === 0) return state
      return {
        ...state,
        project: { ...state.project, glyphs: mergeGlyphs(state.project.glyphs, action.glyphs) },
      }
    }

    // `forgetGlyph` hands back the array it was given when the bitmap was not in the alphabet,
    // which is what makes a removal of nothing cost no undo step.
    case 'glyph/forgotten': {
      if (state.kind !== 'ready') return state
      const glyphs = forgetGlyph(state.project.glyphs, action.bits)
      if (glyphs === state.project.glyphs) return state
      return { ...state, project: { ...state.project, glyphs } }
    }

    case 'relevance-tag/added': {
      if (state.kind !== 'ready') return state
      return {
        ...state,
        project: {
          ...state.project,
          relevanceTags: [...state.project.relevanceTags, action.tag],
        },
      }
    }

    case 'relevance-tag/renamed': {
      if (state.kind !== 'ready') return state
      const target = findRelevanceTag(state.project, action.tagId)
      if (target === null || target.name === action.name) return state
      return withRelevanceTag(state, target, { ...target, name: action.name })
    }

    case 'relevance-tag/hue-set': {
      if (state.kind !== 'ready') return state
      const target = findRelevanceTag(state.project, action.tagId)
      if (target === null || target.hue === action.hue) return state
      return withRelevanceTag(state, target, { ...target, hue: action.hue })
    }

    // The array order is the canonical order `normalizeRelevance` sorts against, so moving a
    // tag changes what a *correct* `relevance` array looks like for every dialogue that carries
    // it — left alone, the next `readRelevance` would silently rewrite them, the whole-file diff
    // the byte-stability tests exist to prevent. The index is clamped rather than rejected, like
    // `moveMedium`'s `toIndex`, so a malformed reorder is simply "last" instead of a no-op.
    case 'relevance-tag/reordered': {
      if (state.kind !== 'ready') return state
      const { project } = state
      const from = project.relevanceTags.findIndex((tag) => tag.id === action.tagId)
      if (from === -1) return state
      const to = Math.min(Math.max(Math.trunc(action.toIndex), 0), project.relevanceTags.length - 1)
      if (from === to) return state

      const relevanceTags = [...project.relevanceTags]
      const [moved] = relevanceTags.splice(from, 1)
      relevanceTags.splice(to, 0, moved)

      const dialogues = project.dialogues.map((dialogue) => {
        const relevance = normalizeRelevance(dialogue.relevance, relevanceTags)
        return isSameRelevance(dialogue.relevance, relevance) ? dialogue : { ...dialogue, relevance }
      })
      const unchanged = dialogues.every((dialogue, index) => dialogue === project.dialogues[index])

      return {
        ...state,
        project: {
          ...project,
          relevanceTags,
          dialogues: unchanged ? project.dialogues : dialogues,
        },
      }
    }

    // A relevance tag is referenced by `Dialogue.relevance` from the other direction a quest
    // references dialogues: leaving the id behind would put a dangling reference into a document
    // whose whole invariant is that it cannot hold one. Dialogues are never deleted, only pruned.
    case 'relevance-tag/deleted': {
      if (state.kind !== 'ready') return state
      const { project } = state
      if (!project.relevanceTags.some((tag) => tag.id === action.tagId)) return state

      const removed = new Set<RelevanceTagId>([action.tagId])
      return {
        ...state,
        project: {
          ...project,
          relevanceTags: project.relevanceTags.filter((tag) => tag.id !== action.tagId),
          dialogues: pruneDialogueRelevance(project.dialogues, removed),
        },
      }
    }

    // Both step through `state.history` and leave every other field alone. A drag or an edit
    // that landed after this document was pushed is not this action's business to worry about:
    // whatever the stack holds is exactly what `trackHistory` recorded for it.
    case 'history/undo': {
      if (state.kind !== 'ready') return state
      const stepped = stepHistory(state.history.undo, state.history.redo, state.project)
      if (stepped === null) return state
      return {
        ...state,
        project: stepped.project,
        history: { undo: stepped.remaining, redo: stepped.carried, coalesceKey: null },
        selection: pruneSelection(state.selection, stepped.project),
      }
    }

    case 'history/redo': {
      if (state.kind !== 'ready') return state
      const stepped = stepHistory(state.history.redo, state.history.undo, state.project)
      if (stepped === null) return state
      return {
        ...state,
        project: stepped.project,
        history: { undo: stepped.carried, redo: stepped.remaining, coalesceKey: null },
        selection: pruneSelection(state.selection, stepped.project),
      }
    }

    default:
      return assertNever(action)
  }
}

/**
 * What `history/undo` and `history/redo` are the same operation over — pop the top of `from`,
 * push the document being left onto `to`. `null` when `from` is empty, so both cases can treat
 * "nothing to step to" as the ordinary no-op every other case returns for.
 */
function stepHistory(
  from: readonly ProjectFile[],
  to: readonly ProjectFile[],
  current: ProjectFile,
): { project: ProjectFile; remaining: readonly ProjectFile[]; carried: readonly ProjectFile[] } | null {
  if (from.length === 0) return null
  return {
    project: from[from.length - 1],
    remaining: from.slice(0, -1),
    carried: [...to, current],
  }
}

/** Bounded so a long session's history does not hold every document version it ever produced. */
const MAX_HISTORY = 100

const EMPTY_HISTORY: History = { undo: [], redo: [], coalesceKey: null }

/**
 * Runs after `applyAction` for anything that actually changed `state`. Undo and redo already
 * computed their own `history` above and must not be pushed onto themselves; `project/loaded`
 * already reset it. Everything else pushes `previous`'s project when the project itself moved —
 * a selection or save-state change alone leaves `next.project === previous.project` and pushes
 * nothing, which is what keeps the stack scoped to *document* actions.
 */
function trackHistory(previous: AppState, next: AppState, action: Action): AppState {
  if (action.kind === 'history/undo' || action.kind === 'history/redo') return next
  if (action.kind === 'project/loaded') return next
  if (previous.kind !== 'ready' || next.kind !== 'ready') return next
  if (previous.project === next.project) return next
  return { ...next, history: pushHistory(next.history, previous.project, action) }
}

/**
 * Records `previous` as the step to return to, unless `action` continues the field edit the most
 * recent push was already for — see `History` in types.ts. Drops the oldest entry past
 * `MAX_HISTORY` rather than rejecting the push, so the stack is always the most recent steps.
 */
function pushHistory(history: History, previous: ProjectFile, action: Action): History {
  const key = coalesceKeyFor(action)
  if (key !== null && key === history.coalesceKey) return history
  const undo =
    history.undo.length >= MAX_HISTORY
      ? [...history.undo.slice(1), previous]
      : [...history.undo, previous]
  return { undo, redo: [], coalesceKey: key }
}

/**
 * Which field `action` edits, for the handful of action kinds a single user gesture can dispatch
 * many of in a row — typing into a text box, dragging a hue slider. `null` is the default and
 * means every dispatch of that kind is its own undo step, which is correct for anything that is
 * not a continuous field edit (adding a zone, deleting a dialogue, and so on).
 */
function coalesceKeyFor(action: Action): string | null {
  switch (action.kind) {
    case 'map/renamed':
      return `map/renamed:${action.mapId}`
    case 'zone/renamed':
      return `zone/renamed:${action.zoneId}`
    case 'zone/hue-set':
      return `zone/hue-set:${action.zoneId}`
    case 'dialogue/npc-named':
      return `dialogue/npc-named:${action.dialogueId}`
    case 'dialogue/text-set':
      return `dialogue/text-set:${action.dialogueId}`
    case 'dialogue/spoken-at-set':
      return `dialogue/spoken-at-set:${action.dialogueId}`
    case 'quest/renamed':
      return `quest/renamed:${action.questId}`
    case 'quest/note-set':
      return `quest/note-set:${action.questId}`
    case 'quest/hue-set':
      return `quest/hue-set:${action.questId}`
    case 'capture-profile/renamed':
      return `capture-profile/renamed:${action.profileId}`
    case 'relevance-tag/renamed':
      return `relevance-tag/renamed:${action.tagId}`
    case 'relevance-tag/hue-set':
      return `relevance-tag/hue-set:${action.tagId}`
    default:
      return null
  }
}

/**
 * Undo or redo can land on a document where the current selection resolves to nothing — a zone
 * deleted and then restored by undo does not get its old id back. A selection pointing at a
 * gone entity would render a detail panel for nothing, same as `dropDeletedSelection` above.
 */
function pruneSelection(selection: Selection, project: ProjectFile): Selection {
  switch (selection.kind) {
    case 'none':
      return selection
    case 'dialogue':
      return project.dialogues.some((dialogue) => dialogue.id === selection.id)
        ? selection
        : { kind: 'none' }
    case 'zone':
      return project.zones.some((zone) => zone.id === selection.id) ? selection : { kind: 'none' }
    case 'map':
      return project.maps.some((map) => map.id === selection.id) ? selection : { kind: 'none' }
    default:
      return assertNever(selection)
  }
}

const EMPTY_DIALOGUE_IDS: ReadonlySet<DialogueId> = new Set<DialogueId>()
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

/** Replaces one zone by reference identity, mirroring `withMap`. */
function withZone(state: ReadyState, target: Zone, replacement: Zone): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      zones: state.project.zones.map((zone) => (zone === target ? replacement : zone)),
    },
  }
}

/** Replaces one quest by reference identity, mirroring `withMap`. */
function withQuest(state: ReadyState, target: Quest, replacement: Quest): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      quests: state.project.quests.map((quest) => (quest === target ? replacement : quest)),
    },
  }
}

/** Replaces one capture profile by reference identity, mirroring `withMap`. */
function withCaptureProfile(
  state: ReadyState,
  target: CaptureProfile,
  replacement: CaptureProfile,
): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      captureProfiles: state.project.captureProfiles.map((profile) =>
        profile === target ? replacement : profile,
      ),
    },
  }
}

/** Replaces one relevance tag by reference identity, mirroring `withMap`. */
function withRelevanceTag(
  state: ReadyState,
  target: RelevanceTag,
  replacement: RelevanceTag,
): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      relevanceTags: state.project.relevanceTags.map((tag) => (tag === target ? replacement : tag)),
    },
  }
}

/** The map a `dialogue/added` or `zone/added` claims to sit on has to be a real one. */
function hasMap(project: ProjectFile, id: MapId): boolean {
  return project.maps.some((map) => map.id === id)
}

function findDialogue(project: ProjectFile, id: DialogueId): Dialogue | null {
  return project.dialogues.find((dialogue) => dialogue.id === id) ?? null
}

function findZone(project: ProjectFile, id: ZoneId): Zone | null {
  return project.zones.find((zone) => zone.id === id) ?? null
}

function findQuest(project: ProjectFile, id: QuestId): Quest | null {
  return project.quests.find((quest) => quest.id === id) ?? null
}

function findCaptureProfile(project: ProjectFile, id: CaptureProfileId): CaptureProfile | null {
  return project.captureProfiles.find((profile) => profile.id === id) ?? null
}

function findRelevanceTag(project: ProjectFile, id: RelevanceTagId): RelevanceTag | null {
  return project.relevanceTags.find((tag) => tag.id === id) ?? null
}

/**
 * The list with one medium moved, or `null` when nothing would change — an unknown id, or a
 * target index that is already where the medium sits. The index is clamped rather than
 * rejected, so a drag past the end of the list means "last" instead of doing nothing.
 */
function moveMedium(
  media: readonly DialogueMedia[],
  mediaId: MediaId,
  toIndex: number,
): DialogueMedia[] | null {
  const from = media.findIndex((medium) => medium.id === mediaId)
  if (from === -1) return null
  const to = Math.min(Math.max(Math.trunc(toIndex), 0), media.length - 1)
  if (from === to) return null
  const next = [...media]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Deduplicated and in the project's own `relevanceTags` order, whatever order the checkboxes
 * were clicked in. That order is the canonical one, so `data.json` stays stable and diffable —
 * toggling a tag off and on again must not reshuffle the array and produce a spurious write.
 */
function normalizeRelevance(
  ids: readonly RelevanceTagId[],
  tags: readonly RelevanceTag[],
): RelevanceTagId[] {
  const chosen = new Set(ids)
  return tags.map((tag) => tag.id).filter((id) => chosen.has(id))
}

/** Both sides are already normalized, so element-wise equality is enough. */
function isSameRelevance(a: readonly RelevanceTagId[], b: readonly RelevanceTagId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
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

/**
 * A relevance tag is referenced by `Dialogue.relevance` from the other direction
 * `pruneQuestDialogues` prunes: a dialogue points at the tag, not the other way round. Mirrors
 * it exactly, pruning the id out of every dialogue that carried it rather than removing anything.
 */
function pruneDialogueRelevance(
  dialogues: Dialogue[],
  removed: ReadonlySet<RelevanceTagId>,
): Dialogue[] {
  return dialogues.map((dialogue) =>
    dialogue.relevance.some((id) => removed.has(id))
      ? { ...dialogue, relevance: dialogue.relevance.filter((id) => !removed.has(id)) }
      : dialogue,
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
  if (a.kind === 'failed' && b.kind === 'failed') {
    return a.message === b.message && a.failure === b.failure
  }
  return true
}

function isSameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'none' || b.kind === 'none' || a.id === b.id
}

// Branded ids: a DialogueId must never be assignable to a ZoneId. Construction is
// confined to ids.ts so the `as` casts exist exactly once per kind.
export type MapId = string & { readonly brand: 'MapId' }
export type ZoneId = string & { readonly brand: 'ZoneId' }
export type DialogueId = string & { readonly brand: 'DialogueId' }
export type QuestId = string & { readonly brand: 'QuestId' }
export type MediaId = string & { readonly brand: 'MediaId' }
export type CaptureProfileId = string & { readonly brand: 'CaptureProfileId' }

/**
 * A coordinate pair, in whichever space the field holding it names.
 *
 * Two spaces exist. **Map-local** is pixels within one map image — `Dialogue.position` and
 * `Zone.polygon` are map-local, and stay that way. **Canvas** is the shared space every map
 * is placed into, one canvas unit being one map pixel at `scale: 1` — `GameMap.origin` is
 * canvas space. See CLAUDE.md § Domain and architecture decisions.
 */
export type Point = { x: number; y: number }

/** At least three vertices — a two-point "region" is not representable. */
export type Polygon = readonly [Point, Point, Point, ...Point[]]

export const RELEVANCE_TAGS = [
  'out-of-world',
  'worldbuilding',
  'peoplebuilding',
  'other',
] as const
export type RelevanceTag = (typeof RELEVANCE_TAGS)[number]

/** A file that physically lives in <project>/media/. Never a URL, never a path. */
export type MediaFile = { fileName: string; mimeType: string; byteSize: number }

/**
 * What a dialogue reads as at a glance, as a runtime list, for anything that has to iterate the
 * possibilities — the canvas legend and the insights filter. It is `DialogueMedia['kind']` plus
 * the text case, which is not a medium: a dialogue that owns no picture still has to be drawn.
 * The `Record<DialogueContentKind, …>` glyph and label maps make forgetting one a compile error
 * at the point where it would otherwise render as nothing.
 */
export const DIALOGUE_CONTENT_KINDS = ['text', 'image', 'gif', 'video'] as const
export type DialogueContentKind = (typeof DIALOGUE_CONTENT_KINDS)[number]

/**
 * One picture of a line. A dialogue owns a list of them, because a line that ran over five text
 * boxes is one thing said and five frames proving it — see CLAUDE.md § Media contract for why
 * the id is part of the file name.
 */
export type DialogueMedia =
  | { id: MediaId; kind: 'image'; file: MediaFile; width: number; height: number }
  | { id: MediaId; kind: 'gif'; file: MediaFile; width: number; height: number }
  | {
      id: MediaId
      kind: 'video'
      file: MediaFile
      width: number
      height: number
      durationMs: number
    }

export type GameMap = {
  id: MapId
  name: string
  file: MediaFile
  /** The image's natural pixel size, and therefore the extent of its map-local space. */
  width: number
  height: number
  /** Top-left corner in canvas space. Moving it carries the map's pins and zones along. */
  origin: Point
  /** Canvas units per map pixel; 1 is native size. */
  scale: number
}

export type Zone = {
  id: ZoneId
  mapId: MapId
  name: string
  polygon: Polygon
  hue: number // 0..359; fill/stroke derived via hsl() so colors stay in one system
}

/**
 * What was said, and what proves it. The two are orthogonal and stored separately: a captured
 * line appends a frame *and* transcribed text, which an exclusive union could not express.
 */
export type Dialogue = {
  id: DialogueId
  mapId: MapId
  npcName: string
  position: Point
  /** The line itself. Empty is ordinary — a picture logged before it was transcribed. */
  text: string
  /** In the order they were captured; the first is what the pin shows. Empty is ordinary too. */
  media: DialogueMedia[]
  /** ISO 8601 from Date#toISOString — when the line was heard in real time. */
  spokenAt: string
  /** Deduplicated, stored in RELEVANCE_TAGS order. Empty = untagged. */
  relevance: RelevanceTag[]
}

/**
 * What a pin, a row and the kind filter show for a dialogue: its first medium, or text when it
 * owns none. Derived on every read for the same reason a location is — a stored summary of the
 * media list would go stale the moment a medium is added or removed.
 */
export function dialogueContentKind(dialogue: Dialogue): DialogueContentKind {
  return dialogue.media.length === 0 ? 'text' : dialogue.media[0].kind
}

/** A pixel rectangle inside a captured frame or a console screen — never canvas space. */
export type PixelRect = { x: number; y: number; width: number; height: number }

/**
 * One 8×8 tile of a console font, and the character it means. `char` may be empty: Pokémon's
 * blinking continuation arrow is a glyph that is recognised and then dropped, which is not the
 * same as an unmatched tile.
 */
export type Glyph = {
  char: string
  /** The bitmap as 16 hex characters, row-major, one bit per pixel. */
  bits: string
}

/**
 * How to cut a console screen out of a captured frame, and where the text box sits inside it.
 * Declared here because it is document state — several per project, written by #52 onwards.
 */
export type CaptureProfile = {
  id: CaptureProfileId
  name: string
  /** Frame size at calibration time. A different size means the profile no longer applies. */
  frameWidth: number
  frameHeight: number
  /** The console screen inside the captured frame, in frame pixels. */
  screenRect: PixelRect
  /** The console's own resolution — 160 × 144 for a Game Boy. With screenRect it fixes the grid. */
  nativeWidth: number
  nativeHeight: number
  /** The text box, in native pixels, snapped to the 8-pixel tile grid. */
  textRect: PixelRect
  /** The alphabet learned so far. Empty until #53 fills it. */
  glyphs: Glyph[]
}

/**
 * A union, not a boolean: leaves room for 'abandoned' without a schema break. The runtime
 * list is what the quest board iterates to build its groups, so a third status would appear
 * there without the board learning a new name.
 */
export const QUEST_STATUSES = ['open', 'done'] as const
export type QuestStatus = (typeof QUEST_STATUSES)[number]

export type Quest = {
  id: QuestId
  name: string
  status: QuestStatus
  dialogueIds: DialogueId[]
  note: string
  /**
   * 0..359, stored rather than hashed from the id: a pin can carry one flag per quest, so the
   * hues have to be distinguishable *and* correctable by hand. `quest-style.ts` derives every
   * colour from it, and overrides it for a done quest.
   */
  hue: number
}

// ---- on-disk schema ----

/** A V1 map: no placement, because V1 showed exactly one map at a time. */
export type GameMapV1 = {
  id: MapId
  name: string
  file: MediaFile
  width: number
  height: number
}

/**
 * A V1–V3 dialogue: one exclusive content slot, so a line was *either* text or one file and
 * never both. `readDialogueV3` is the only thing that still reads this shape.
 */
export type DialogueV3 = {
  id: DialogueId
  mapId: MapId
  npcName: string
  position: Point
  content:
    | { kind: 'text'; text: string }
    | { kind: 'image'; file: MediaFile; width: number; height: number }
    | { kind: 'gif'; file: MediaFile; width: number; height: number }
    | { kind: 'video'; file: MediaFile; width: number; height: number; durationMs: number }
  spokenAt: string
  relevance: RelevanceTag[]
}

/** A V1/V2 quest: no colour, because every quest was drawn in one shared gold. */
export type QuestV2 = {
  id: QuestId
  name: string
  status: QuestStatus
  dialogueIds: DialogueId[]
  note: string
}

export type ProjectFileV1 = {
  /** Literal, not `number`: every version discriminates on it in parseProjectFile. */
  schemaVersion: 1
  projectName: string
  savedAt: string
  maps: GameMapV1[]
  zones: Zone[]
  dialogues: DialogueV3[]
  quests: QuestV2[]
}

/** V2 places every map on one shared canvas, so maps carry `origin` and `scale`. */
export type ProjectFileV2 = {
  schemaVersion: 2
  projectName: string
  savedAt: string
  maps: GameMap[]
  zones: Zone[]
  dialogues: DialogueV3[]
  quests: QuestV2[]
}

/** V3 gives every quest its own hue, so a pin can fly one flag per quest it belongs to. */
export type ProjectFileV3 = {
  schemaVersion: 3
  projectName: string
  savedAt: string
  maps: GameMap[]
  zones: Zone[]
  dialogues: DialogueV3[]
  quests: Quest[]
}

/**
 * V4 splits a dialogue into what was said and the pictures of it, and gives the project the
 * capture profiles those pictures come from.
 */
export type ProjectFileV4 = {
  schemaVersion: 4
  projectName: string
  savedAt: string
  maps: GameMap[]
  zones: Zone[]
  dialogues: Dialogue[]
  quests: Quest[]
  captureProfiles: CaptureProfile[]
}

/**
 * Every shape a `data.json` on disk may have. Only `parseProjectFile` handles this union;
 * it migrates anything older forward, so nothing downstream branches on a version.
 */
export type StoredProjectFile = ProjectFileV1 | ProjectFileV2 | ProjectFileV3 | ProjectFileV4

/** The current shape, and the only one the store, the components, and writes ever see. */
export type ProjectFile = ProjectFileV4

/**
 * What `parseProjectFile` had to drop to hand back a referentially whole document. Counts, not
 * records: the user cannot act on the record itself — it is already gone from the document they
 * are looking at — only on the fact that the folder held one.
 *
 * `none` is a distinct member rather than three zeroes so a clean load cannot be mistaken for a
 * repair that happened to drop nothing, and so the notice has one thing to test.
 */
export type ProjectRepairs =
  | { kind: 'none' }
  | {
      kind: 'repaired'
      /** Dialogues whose `mapId` named no map. */
      dialogues: number
      /** Zones whose `mapId` named no map. */
      zones: number
      /** Quest references that named no dialogue, summed over every quest. */
      questDialogueIds: number
    }

// ---- in-memory app state ----

/**
 * Why a write failed, and therefore what the retry has to do first. Chromium can drop a
 * `readwrite` grant mid-session; every later write then throws `NotAllowedError`, and a plain
 * retry can only throw it again. Re-granting is `requestPermission`, which prompts only inside
 * a user gesture — so the distinction has to survive as far as the button that offers it.
 */
export type SaveFailure = 'write' | 'permission'

export type SaveState =
  | { kind: 'saved'; at: string }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'failed'; message: string; failure: SaveFailure }

export type Selection =
  | { kind: 'none' }
  | { kind: 'dialogue'; id: DialogueId }
  | { kind: 'zone'; id: ZoneId }
  | { kind: 'map'; id: MapId }

/**
 * Document snapshots to step back to or forward to, over `ProjectFile` references rather than
 * copies — the reducer already returns a fresh one for anything that changed, which is what
 * makes pushing cheap. `coalesceKey` names the field the most recent push was for; the next
 * action that reports the same key extends that step instead of pushing a new one, so a burst
 * of keystrokes into one field undoes as a single step. `null` after `history/undo` and
 * `history/redo`, so stepping and then immediately editing the same field again does not
 * silently merge into the step just landed on.
 */
export type History = {
  undo: readonly ProjectFile[]
  redo: readonly ProjectFile[]
  coalesceKey: string | null
}

export type AppState =
  | { kind: 'unsupported' }
  | { kind: 'disconnected' }
  | { kind: 'reconnecting'; directoryName: string }
  | { kind: 'loading'; directoryName: string }
  | { kind: 'load-failed'; directoryName: string; message: string }
  | {
      kind: 'ready'
      directoryName: string
      project: ProjectFile
      /**
       * What the load had to drop to make the document referentially whole. Set once, by
       * `project/loaded`, and never again — the document cannot grow a dangling reference
       * while the app is running, because the reducer guards every edge that could add one.
       */
      repairs: ProjectRepairs
      save: SaveState
      selection: Selection
      history: History
    }

/**
 * Which gesture the canvas is in. A tool carries no draft: an in-progress rectangle lives in
 * `MapCanvas`'s own refs and state, because it changes every frame and the tool is a prop.
 */
export type CanvasTool =
  | { kind: 'inspect' }
  | { kind: 'place-dialogue' }
  | { kind: 'move-map' }
  | { kind: 'draw-zone' }

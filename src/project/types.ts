// Branded ids: a DialogueId must never be assignable to a ZoneId. Construction is
// confined to ids.ts so the `as` casts exist exactly once per kind.
export type MapId = string & { readonly brand: 'MapId' }
export type ZoneId = string & { readonly brand: 'ZoneId' }
export type DialogueId = string & { readonly brand: 'DialogueId' }
export type QuestId = string & { readonly brand: 'QuestId' }
export type MediaId = string & { readonly brand: 'MediaId' }
export type CaptureProfileId = string & { readonly brand: 'CaptureProfileId' }
export type RelevanceTagId = string & { readonly brand: 'RelevanceTagId' }
export type PendingCaptureId = string & { readonly brand: 'PendingCaptureId' }

/** Map-local (`Dialogue.position`, `Zone.polygon`) or canvas (`GameMap.origin`) — see CLAUDE.md. */
export type Point = { x: number; y: number }

/** At least three vertices — a two-point "region" is not representable. */
export type Polygon = readonly [Point, Point, Point, ...Point[]]

/** A project-owned relevance tag; position in `ProjectFile['relevanceTags']` is display order. */
export type RelevanceTag = { id: RelevanceTagId; name: string; hue: number }

/** A file that physically lives in <project>/media/. Never a URL, never a path. */
export type MediaFile = { fileName: string; mimeType: string; byteSize: number }

/** `DialogueMedia['kind']` plus `'text'`, since a dialogue with no picture still has to render. */
export const DIALOGUE_CONTENT_KINDS = ['text', 'image', 'gif', 'video'] as const
export type DialogueContentKind = (typeof DIALOGUE_CONTENT_KINDS)[number]

/** One picture of a line — a dialogue owns a list because one line can span several frames. */
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
  width: number
  height: number
  /** Top-left corner in canvas space; moving it carries the map's pins and zones along. */
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

/** Text and media are orthogonal and stored separately — a captured line can append both. */
export type Dialogue = {
  id: DialogueId
  mapId: MapId
  npcName: string
  position: Point
  text: string
  media: DialogueMedia[]
  /** ISO 8601 from Date#toISOString. */
  spokenAt: string
  /** Deduplicated, stored in `project.relevanceTags` order. */
  relevance: RelevanceTagId[]
  /** Other lines this one points at — untyped, directed, stored. */
  references: DialogueId[]
}

/**
 * A conversation the watcher recorded before anyone said where it happened — every `Dialogue`
 * field except `mapId`/`position`. No field spells "unknown" (location is derived, never
 * stored — see CLAUDE.md), so an unplaced capture lives in its own list rather than widening
 * `Dialogue` into a placed/unplaced union.
 */
export type PendingCapture = {
  id: PendingCaptureId
  npcName: string
  text: string
  media: DialogueMedia[]
  spokenAt: string
  relevance: RelevanceTagId[]
}

/** Derived on every read, like location — a stored summary would go stale on media add/remove. */
export function dialogueContentKind(dialogue: Dialogue): DialogueContentKind {
  return dialogue.media.length === 0 ? 'text' : dialogue.media[0].kind
}

/** A pixel rectangle inside a captured frame or a console screen — never canvas space. */
export type PixelRect = { x: number; y: number; width: number; height: number }

/** One 8x8 tile of a console font. `char` may be empty — a recognised-then-dropped glyph. */
export type Glyph = {
  char: string
  /** 16 hex characters, row-major, one bit per pixel. */
  bits: string
}

/**
 * How to cut a console screen out of a captured frame, and where the text box sits inside it.
 * The font is not a measurement here — it is the console's, shared via `ProjectFile.glyphs`.
 */
export type CaptureProfile = {
  id: CaptureProfileId
  name: string
  /** Frame size at calibration time; a different size means the profile no longer applies. */
  frameWidth: number
  frameHeight: number
  screenRect: PixelRect
  /** The console's own resolution — 160x144 for a Game Boy. With screenRect it fixes the grid. */
  nativeWidth: number
  nativeHeight: number
  /** Snapped to the 8-pixel tile grid, in native pixels. */
  textRect: PixelRect
}

/** A runtime list, not fixed nullable fields — a third trigger is a new value, not a new field. */
export const RECORDER_ACTIONS = ['record-new', 'record-extend', 'cycle-profile'] as const
export type RecorderAction = (typeof RECORDER_ACTIONS)[number]

/** Lives on the project, not a `CaptureProfile` — it says how this player triggers, not a
 *  console measurement. No keyboard variant on purpose (#107). */
export type RecorderBinding = { action: RecorderAction; buttonIndex: number }

/** A union, not a boolean — leaves room for e.g. 'abandoned' without a schema break. */
export const QUEST_STATUSES = ['open', 'done'] as const
export type QuestStatus = (typeof QUEST_STATUSES)[number]

export type Quest = {
  id: QuestId
  name: string
  status: QuestStatus
  dialogueIds: DialogueId[]
  note: string
  /** 0..359, stored rather than hashed from the id — correctable by hand; see quest-style.ts. */
  hue: number
}

// ---- on-disk schema ----

/**
 * The only schema shape the app reads or writes. To evolve it, see CLAUDE.md § "Schema
 * versioning" — one reader for the current version, at most one migration step back.
 */
export type ProjectFile = {
  schemaVersion: 11
  projectName: string
  savedAt: string
  maps: GameMap[]
  zones: Zone[]
  dialogues: Dialogue[]
  quests: Quest[]
  captureProfiles: CaptureProfile[]
  relevanceTags: RelevanceTag[]
  glyphs: Glyph[]
  pendingCaptures: PendingCapture[]
  recorderBindings: RecorderBinding[]
}

/**
 * What `parseProjectFile` had to drop to hand back a referentially whole document — counts, not
 * records, since the user can only act on the fact that something was dropped, not the record
 * itself. `none` is a distinct member so a clean load can't be mistaken for a repair of nothing.
 */
export type ProjectRepairs =
  | { kind: 'none' }
  | {
      kind: 'repaired'
      dialogues: number
      zones: number
      questDialogueIds: number
      relevance: number
      dialogueReferences: number
    }

// ---- in-memory app state ----

/**
 * Chromium can drop a `readwrite` grant mid-session; every later write then throws
 * `NotAllowedError`. Re-granting is `requestPermission`, which prompts only inside a user
 * gesture, so the distinction has to survive as far as the button that offers it.
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
 * Undo/redo over `ProjectFile` references, not copies. `coalesceKey` names the field the most
 * recent push was for; the next action reporting the same key extends that step instead of
 * pushing a new one. `null` after undo/redo so the step just landed on cannot silently merge.
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
      /** Set once by `project/loaded`; the reducer guards every edge that could add another. */
      repairs: ProjectRepairs
      save: SaveState
      selection: Selection
      history: History
    }

/** A tool carries no draft — an in-progress rectangle lives in `MapCanvas`'s own state. */
export type CanvasTool =
  | { kind: 'inspect' }
  | { kind: 'place-dialogue' }
  | { kind: 'move-map' }
  | { kind: 'draw-zone' }
  | { kind: 'pick-reference'; dialogueId: DialogueId }

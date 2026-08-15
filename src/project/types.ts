// Branded ids: a DialogueId must never be assignable to a ZoneId. Construction is
// confined to ids.ts so the `as` casts exist exactly once per kind.
export type MapId = string & { readonly brand: 'MapId' }
export type ZoneId = string & { readonly brand: 'ZoneId' }
export type DialogueId = string & { readonly brand: 'DialogueId' }
export type QuestId = string & { readonly brand: 'QuestId' }

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
 * The content kinds, as a runtime list, for anything that has to iterate them — the canvas
 * legend, chiefly. Kept beside the union: a fifth variant has to be added to both, and the
 * `Record<DialogueContent['kind'], …>` glyph and label maps make forgetting one a compile
 * error at the point where it would otherwise render as nothing.
 */
export const DIALOGUE_CONTENT_KINDS = ['text', 'image', 'gif', 'video'] as const

export type DialogueContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; file: MediaFile; width: number; height: number }
  | { kind: 'gif'; file: MediaFile; width: number; height: number }
  | { kind: 'video'; file: MediaFile; width: number; height: number; durationMs: number }

/**
 * The variants that own a file in `media/`. Derived rather than declared, so a fifth content
 * kind joins it automatically and every `file`-handling site fails to compile until it is
 * handled.
 */
export type DialogueMediaContent = Exclude<DialogueContent, { kind: 'text' }>

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

export type Dialogue = {
  id: DialogueId
  mapId: MapId
  npcName: string
  position: Point
  content: DialogueContent
  /** ISO 8601 from Date#toISOString — when the line was heard in real time. */
  spokenAt: string
  /** Deduplicated, stored in RELEVANCE_TAGS order. Empty = untagged. */
  relevance: RelevanceTag[]
}

export type Quest = {
  id: QuestId
  name: string
  /** A union, not a boolean: leaves room for 'abandoned' without a schema break. */
  status: 'open' | 'done'
  dialogueIds: DialogueId[]
  note: string
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

export type ProjectFileV1 = {
  /** Literal, not `number`: every version discriminates on it in parseProjectFile. */
  schemaVersion: 1
  projectName: string
  savedAt: string
  maps: GameMapV1[]
  zones: Zone[]
  dialogues: Dialogue[]
  quests: Quest[]
}

/** V2 places every map on one shared canvas, so maps carry `origin` and `scale`. */
export type ProjectFileV2 = {
  schemaVersion: 2
  projectName: string
  savedAt: string
  maps: GameMap[]
  zones: Zone[]
  dialogues: Dialogue[]
  quests: Quest[]
}

/**
 * Every shape a `data.json` on disk may have. Only `parseProjectFile` handles this union;
 * it migrates anything older forward, so nothing downstream branches on a version.
 */
export type StoredProjectFile = ProjectFileV1 | ProjectFileV2

/** The current shape, and the only one the store, the components, and writes ever see. */
export type ProjectFile = ProjectFileV2

// ---- in-memory app state ----

export type SaveState =
  | { kind: 'saved'; at: string }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'failed'; message: string }

export type Selection =
  | { kind: 'none' }
  | { kind: 'dialogue'; id: DialogueId }
  | { kind: 'zone'; id: ZoneId }
  | { kind: 'map'; id: MapId }

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
      save: SaveState
      selection: Selection
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

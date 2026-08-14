// Branded ids: a DialogueId must never be assignable to a ZoneId. Construction is
// confined to ids.ts so the `as` casts exist exactly once per kind.
export type MapId = string & { readonly brand: 'MapId' }
export type ZoneId = string & { readonly brand: 'ZoneId' }
export type DialogueId = string & { readonly brand: 'DialogueId' }
export type QuestId = string & { readonly brand: 'QuestId' }

/** Map-image pixel coordinates. The map image's natural size IS the world space. */
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

export type DialogueContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; file: MediaFile; width: number; height: number }
  | { kind: 'gif'; file: MediaFile; width: number; height: number }
  | { kind: 'video'; file: MediaFile; width: number; height: number; durationMs: number }

export type GameMap = { id: MapId; name: string; file: MediaFile; width: number; height: number }

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

export type ProjectFileV1 = {
  /** Literal, not `number`: future versions discriminate on it in parseProjectFile. */
  schemaVersion: 1
  projectName: string
  savedAt: string
  maps: GameMap[]
  zones: Zone[]
  dialogues: Dialogue[]
  quests: Quest[]
}
export type ProjectFile = ProjectFileV1

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

export type CanvasTool =
  | { kind: 'inspect' }
  | { kind: 'place-dialogue' }
  | { kind: 'draw-zone'; points: Point[] }

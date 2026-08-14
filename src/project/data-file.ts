import { asDialogueId, asMapId, asQuestId, asZoneId } from './ids.ts'
import type {
  Dialogue,
  DialogueContent,
  DialogueId,
  GameMap,
  MapId,
  MediaFile,
  Point,
  Polygon,
  ProjectFile,
  Quest,
  QuestId,
  RelevanceTag,
  Zone,
  ZoneId,
} from './types.ts'
import { RELEVANCE_TAGS } from './types.ts'

/** The document written to `<project>/data.json` when a folder is first connected. */
export function createEmptyProject(name: string): ProjectFile {
  return {
    schemaVersion: 1,
    projectName: name,
    savedAt: new Date().toISOString(),
    maps: [],
    zones: [],
    dialogues: [],
    quests: [],
  }
}

/**
 * Pretty-printed with 2-space indent so the project folder stays diffable and reviewable
 * in git — the file is the user's data, not an opaque blob.
 */
export function serializeProject(file: ProjectFile): string {
  return JSON.stringify({ ...file, savedAt: new Date().toISOString() }, null, 2)
}

export type ParseResult =
  | { ok: true; file: ProjectFile }
  | { ok: false; message: string }

/**
 * Hand-written validation, no schema library — see CLAUDE.md § Dependencies for the
 * tripwire that would make `zod` worth it.
 *
 * This is also the designated **migration entry point**. When `ProjectFileV2` is added,
 * branch on `schemaVersion` in `readProjectFile` and migrate forward to the newest shape,
 * so every caller downstream keeps seeing only the current `ProjectFile`.
 *
 * Every field is copied out explicitly rather than spread, which is what makes unknown
 * extra keys tolerated on read and dropped on the next write.
 */
export function parseProjectFile(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, message: `data.json is not valid JSON: ${describe(error)}` }
  }

  try {
    return { ok: true, file: readProjectFile(raw) }
  } catch (error) {
    if (error instanceof SchemaError) return { ok: false, message: error.message }
    throw error
  }
}

/** Carries the offending path so a rejection points at a field, not at the whole file. */
class SchemaError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`)
    this.name = 'SchemaError'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---- primitives ----

function readObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaError(path, 'an object')
  }
  return value as Record<string, unknown>
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(path, 'an array')
  return value
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SchemaError(path, 'a string')
  return value
}

function readNumber(value: unknown, path: string): number {
  // NaN and Infinity survive no JSON round trip, so rejecting them here keeps every
  // number in the document writable back out.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SchemaError(path, 'a finite number')
  }
  return value
}

function readMapId(value: unknown, path: string): MapId {
  return asMapId(readString(value, path))
}

function readZoneId(value: unknown, path: string): ZoneId {
  return asZoneId(readString(value, path))
}

function readDialogueId(value: unknown, path: string): DialogueId {
  return asDialogueId(readString(value, path))
}

function readQuestId(value: unknown, path: string): QuestId {
  return asQuestId(readString(value, path))
}

// ---- domain ----

function readPoint(value: unknown, path: string): Point {
  const raw = readObject(value, path)
  return {
    x: readNumber(raw.x, `${path}.x`),
    y: readNumber(raw.y, `${path}.y`),
  }
}

function readPolygon(value: unknown, path: string): Polygon {
  const raw = readArray(value, path)
  if (raw.length < 3) throw new SchemaError(path, 'at least 3 points')
  const points = raw.map((point, index) => readPoint(point, `${path}[${index}]`))
  // Destructured rather than cast: the length check above already proved the shape, and
  // rebuilding the tuple is how that proof reaches the type system without an assertion.
  const [first, second, third, ...rest] = points
  return [first, second, third, ...rest]
}

function readMediaFile(value: unknown, path: string): MediaFile {
  const raw = readObject(value, path)
  return {
    fileName: readString(raw.fileName, `${path}.fileName`),
    mimeType: readString(raw.mimeType, `${path}.mimeType`),
    byteSize: readNumber(raw.byteSize, `${path}.byteSize`),
  }
}

function readRelevance(value: unknown, path: string): RelevanceTag[] {
  const raw = readArray(value, path)
  const found = raw.map((tag, index) => {
    const text = readString(tag, `${path}[${index}]`)
    if (!isRelevanceTag(text)) {
      throw new SchemaError(`${path}[${index}]`, `one of ${RELEVANCE_TAGS.join(', ')}`)
    }
    return text
  })
  // Rebuilt from RELEVANCE_TAGS rather than returned as read, which enforces the
  // "deduplicated, in RELEVANCE_TAGS order" invariant on a hand-edited file too.
  return RELEVANCE_TAGS.filter((tag) => found.includes(tag))
}

function isRelevanceTag(value: string): value is RelevanceTag {
  return (RELEVANCE_TAGS as readonly string[]).includes(value)
}

function readDialogueContent(value: unknown, path: string): DialogueContent {
  const raw = readObject(value, path)
  const kind = readString(raw.kind, `${path}.kind`)
  switch (kind) {
    case 'text':
      return { kind: 'text', text: readString(raw.text, `${path}.text`) }

    case 'image':
    case 'gif':
      return {
        kind,
        file: readMediaFile(raw.file, `${path}.file`),
        width: readNumber(raw.width, `${path}.width`),
        height: readNumber(raw.height, `${path}.height`),
      }

    case 'video':
      return {
        kind: 'video',
        file: readMediaFile(raw.file, `${path}.file`),
        width: readNumber(raw.width, `${path}.width`),
        height: readNumber(raw.height, `${path}.height`),
        durationMs: readNumber(raw.durationMs, `${path}.durationMs`),
      }

    default:
      throw new SchemaError(`${path}.kind`, "one of text, image, gif, video")
  }
}

function readGameMap(value: unknown, path: string): GameMap {
  const raw = readObject(value, path)
  return {
    id: readMapId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    file: readMediaFile(raw.file, `${path}.file`),
    width: readNumber(raw.width, `${path}.width`),
    height: readNumber(raw.height, `${path}.height`),
  }
}

function readZone(value: unknown, path: string): Zone {
  const raw = readObject(value, path)
  return {
    id: readZoneId(raw.id, `${path}.id`),
    mapId: readMapId(raw.mapId, `${path}.mapId`),
    name: readString(raw.name, `${path}.name`),
    polygon: readPolygon(raw.polygon, `${path}.polygon`),
    hue: readNumber(raw.hue, `${path}.hue`),
  }
}

function readDialogue(value: unknown, path: string): Dialogue {
  const raw = readObject(value, path)
  return {
    id: readDialogueId(raw.id, `${path}.id`),
    mapId: readMapId(raw.mapId, `${path}.mapId`),
    npcName: readString(raw.npcName, `${path}.npcName`),
    position: readPoint(raw.position, `${path}.position`),
    content: readDialogueContent(raw.content, `${path}.content`),
    spokenAt: readString(raw.spokenAt, `${path}.spokenAt`),
    relevance: readRelevance(raw.relevance, `${path}.relevance`),
  }
}

function readQuest(value: unknown, path: string): Quest {
  const raw = readObject(value, path)
  return {
    id: readQuestId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    status: readQuestStatus(raw.status, `${path}.status`),
    dialogueIds: readArray(raw.dialogueIds, `${path}.dialogueIds`).map((id, index) =>
      readDialogueId(id, `${path}.dialogueIds[${index}]`),
    ),
    note: readString(raw.note, `${path}.note`),
  }
}

function readQuestStatus(value: unknown, path: string): Quest['status'] {
  const status = readString(value, path)
  if (status !== 'open' && status !== 'done') throw new SchemaError(path, 'open or done')
  return status
}

function readProjectFile(value: unknown): ProjectFile {
  const raw = readObject(value, 'data.json')

  // Branch here when ProjectFileV2 exists: read the old shape, migrate it forward, and
  // return the current ProjectFile. Never redefine what an existing field means.
  const schemaVersion = readNumber(raw.schemaVersion, 'schemaVersion')
  if (schemaVersion !== 1) {
    throw new SchemaError('schemaVersion', `1, but found ${String(schemaVersion)}`)
  }

  return {
    schemaVersion: 1,
    projectName: readString(raw.projectName, 'projectName'),
    savedAt: readString(raw.savedAt, 'savedAt'),
    maps: readArray(raw.maps, 'maps').map((map, index) => readGameMap(map, `maps[${index}]`)),
    zones: readArray(raw.zones, 'zones').map((zone, index) => readZone(zone, `zones[${index}]`)),
    dialogues: readArray(raw.dialogues, 'dialogues').map((dialogue, index) =>
      readDialogue(dialogue, `dialogues[${index}]`),
    ),
    quests: readArray(raw.quests, 'quests').map((quest, index) =>
      readQuest(quest, `quests[${index}]`),
    ),
  }
}

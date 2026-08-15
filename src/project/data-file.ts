import { nextMapOrigin } from '../map/canvas-layout.ts'
import { nextQuestHue } from '../quest/quest-style.ts'
import { asDialogueId, asMapId, asQuestId, asZoneId } from './ids.ts'
import type {
  Dialogue,
  DialogueContent,
  DialogueId,
  GameMap,
  GameMapV1,
  MapId,
  MediaFile,
  Point,
  Polygon,
  ProjectFile,
  ProjectFileV1,
  ProjectFileV2,
  Quest,
  QuestId,
  QuestStatus,
  QuestV2,
  RelevanceTag,
  Zone,
  ZoneId,
} from './types.ts'
import { QUEST_STATUSES, RELEVANCE_TAGS } from './types.ts'

/** The document written to `<project>/data.json` when a folder is first connected. */
export function createEmptyProject(name: string): ProjectFile {
  return {
    schemaVersion: 3,
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
 * This is also the designated **migration entry point**: `readProjectFile` branches on
 * `schemaVersion` and migrates forward to the newest shape, so every caller downstream keeps
 * seeing only the current `ProjectFile`. Add a version by extending that branch — never by
 * redefining what an existing field means.
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

function readGameMapV1(value: unknown, path: string): GameMapV1 {
  const raw = readObject(value, path)
  return {
    id: readMapId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    file: readMediaFile(raw.file, `${path}.file`),
    width: readNumber(raw.width, `${path}.width`),
    height: readNumber(raw.height, `${path}.height`),
  }
}

function readGameMap(value: unknown, path: string): GameMap {
  const raw = readObject(value, path)
  return {
    ...readGameMapV1(value, path),
    origin: readPoint(raw.origin, `${path}.origin`),
    scale: readNumber(raw.scale, `${path}.scale`),
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

function readQuestV2(value: unknown, path: string): QuestV2 {
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

function readQuest(value: unknown, path: string): Quest {
  const raw = readObject(value, path)
  return {
    ...readQuestV2(value, path),
    hue: readNumber(raw.hue, `${path}.hue`),
  }
}

function readQuestStatus(value: unknown, path: string): QuestStatus {
  const status = readString(value, path)
  if (!isQuestStatus(status)) throw new SchemaError(path, QUEST_STATUSES.join(' or '))
  return status
}

function isQuestStatus(value: string): value is QuestStatus {
  return (QUEST_STATUSES as readonly string[]).includes(value)
}

/**
 * Migrations chain one step at a time rather than jumping straight to the newest shape: a
 * fourth version then adds one `migrateV3` and one `case`, instead of a new N→newest function
 * per version already on disk.
 */
function readProjectFile(value: unknown): ProjectFile {
  const raw = readObject(value, 'data.json')
  const schemaVersion = readNumber(raw.schemaVersion, 'schemaVersion')
  switch (schemaVersion) {
    case 1:
      return migrateV2(migrateV1(readProjectFileV1(raw)))
    case 2:
      return migrateV2(readProjectFileV2(raw))
    case 3:
      return readProjectFileV3(raw)
    default:
      throw new SchemaError('schemaVersion', `1, 2 or 3, but found ${String(schemaVersion)}`)
  }
}

/** `maps` and `quests` differ per version; everything else is read by the same functions. */
function readCommonFields(
  raw: Record<string, unknown>,
): Omit<ProjectFile, 'schemaVersion' | 'maps' | 'quests'> {
  return {
    projectName: readString(raw.projectName, 'projectName'),
    savedAt: readString(raw.savedAt, 'savedAt'),
    zones: readArray(raw.zones, 'zones').map((zone, index) => readZone(zone, `zones[${index}]`)),
    dialogues: readArray(raw.dialogues, 'dialogues').map((dialogue, index) =>
      readDialogue(dialogue, `dialogues[${index}]`),
    ),
  }
}

function readQuestsV2(raw: Record<string, unknown>): QuestV2[] {
  return readArray(raw.quests, 'quests').map((quest, index) =>
    readQuestV2(quest, `quests[${index}]`),
  )
}

function readProjectFileV1(raw: Record<string, unknown>): ProjectFileV1 {
  return {
    schemaVersion: 1,
    ...readCommonFields(raw),
    maps: readArray(raw.maps, 'maps').map((map, index) => readGameMapV1(map, `maps[${index}]`)),
    quests: readQuestsV2(raw),
  }
}

function readProjectFileV2(raw: Record<string, unknown>): ProjectFileV2 {
  return {
    schemaVersion: 2,
    ...readCommonFields(raw),
    maps: readArray(raw.maps, 'maps').map((map, index) => readGameMap(map, `maps[${index}]`)),
    quests: readQuestsV2(raw),
  }
}

function readProjectFileV3(raw: Record<string, unknown>): ProjectFile {
  return {
    schemaVersion: 3,
    ...readCommonFields(raw),
    maps: readArray(raw.maps, 'maps').map((map, index) => readGameMap(map, `maps[${index}]`)),
    quests: readArray(raw.quests, 'quests').map((quest, index) =>
      readQuest(quest, `quests[${index}]`),
    ),
  }
}

/**
 * V1 had no shared canvas, so its maps have no placement. They are laid out left to right at
 * native scale through the same `nextMapOrigin` an import uses, which is what guarantees a
 * migrated project opens with nothing overlapping.
 */
function migrateV1(file: ProjectFileV1): ProjectFileV2 {
  const maps: GameMap[] = []
  for (const map of file.maps) {
    maps.push({ ...map, origin: nextMapOrigin(maps), scale: 1 })
  }
  return { ...file, schemaVersion: 2, maps }
}

/**
 * V2 drew every quest in one shared gold. Colours are handed out through the same
 * `nextQuestHue` a newly created quest calls, with the array built up as it goes so each quest
 * sees the ones already coloured — the migration and the board therefore colour identically.
 */
function migrateV2(file: ProjectFileV2): ProjectFile {
  const quests: Quest[] = []
  for (const quest of file.quests) {
    quests.push({ ...quest, hue: nextQuestHue(quests) })
  }
  return { ...file, schemaVersion: 3, quests }
}

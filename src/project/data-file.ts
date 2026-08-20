import { clampMapScale, nextMapOrigin } from '../map/canvas-layout.ts'
import { nextQuestHue } from '../quest/quest-style.ts'
import {
  asCaptureProfileId,
  asDialogueId,
  asMapId,
  asMediaId,
  asQuestId,
  asZoneId,
  newMediaId,
} from './ids.ts'
import type {
  CaptureProfile,
  CaptureProfileId,
  Dialogue,
  DialogueId,
  DialogueMedia,
  DialogueV3,
  GameMap,
  GameMapV1,
  Glyph,
  MapId,
  MediaFile,
  MediaId,
  PixelRect,
  Point,
  Polygon,
  ProjectFile,
  ProjectFileV1,
  ProjectFileV2,
  ProjectFileV3,
  ProjectRepairs,
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
    schemaVersion: 4,
    projectName: name,
    savedAt: new Date().toISOString(),
    maps: [],
    zones: [],
    dialogues: [],
    quests: [],
    captureProfiles: [],
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
  | { ok: true; file: ProjectFile; repairs: ProjectRepairs }
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
    return { ok: true, ...readProjectFile(raw) }
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

/**
 * A measurement, not a coordinate: a size of zero or less is never a legitimate value and is
 * always divided by, laid out with, or allocated from somewhere downstream.
 */
function readPositiveNumber(value: unknown, path: string): number {
  const number = readNumber(value, path)
  if (number <= 0) throw new SchemaError(path, 'a number greater than 0')
  return number
}

/**
 * A measurement that is allowed to be unknown. Only `durationMs` is: `probeVideoSize` stores
 * `0` for a container whose header carries no length, and calls zero "the honest unknown" —
 * so rejecting it here would make a clip the app itself imported take the whole project down
 * on the next load. Nothing divides by it; it is displayed or it is not.
 */
function readNonNegativeNumber(value: unknown, path: string): number {
  const number = readNumber(value, path)
  if (number < 0) throw new SchemaError(path, 'a number of 0 or more')
  return number
}

/** 0..359, the invariant `types.ts` declares and every hsl() downstream assumes. */
function readHue(value: unknown, path: string): number {
  const hue = readNumber(value, path)
  if (hue < 0 || hue > 359) throw new SchemaError(path, 'a hue in 0..359')
  return hue
}

/**
 * A timestamp that `new Date()` can actually read. `savedAt` reaches `Nav.tsx` and `spokenAt`
 * the timeline, both of which format it — and `Intl.DateTimeFormat#format` throws
 * `RangeError` on an invalid date, during render, where there is no recovering the value.
 * Rejecting the document at parse time is the only place the user can still be told which
 * field is wrong.
 */
function readInstant(value: unknown, path: string): string {
  const text = readString(value, path)
  if (!Number.isFinite(Date.parse(text))) {
    throw new SchemaError(path, 'a date the browser can read, such as 2026-08-14T10:00:00.000Z')
  }
  return text
}

/**
 * Ids are the document's only identity. A duplicate parses cleanly today and then goes wrong
 * silently and differently everywhere: `withDialogue` replaces by reference so only one copy
 * is editable, a delete removes both, `PinLayer` renders two nodes under one React key, and
 * `indexDialoguesByZone` keeps whichever came last. Copy-pasting a block in the
 * pretty-printed `data.json` is all it takes.
 */
function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      throw new SchemaError(`${path}[${index}].id`, `an id not already used, but "${item.id}" is`)
    }
    seen.add(item.id)
  })
}

/** Reads an array of records and rejects the whole document if two of them share an id. */
function readUniqueArray<T extends { id: string }>(
  raw: Record<string, unknown>,
  key: string,
  read: (value: unknown, path: string) => T,
): T[] {
  const items = readArray(raw[key], key).map((item, index) => read(item, `${key}[${index}]`))
  assertUniqueIds(items, key)
  return items
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

function readMediaId(value: unknown, path: string): MediaId {
  return asMediaId(readString(value, path))
}

function readCaptureProfileId(value: unknown, path: string): CaptureProfileId {
  return asCaptureProfileId(readString(value, path))
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
    byteSize: readPositiveNumber(raw.byteSize, `${path}.byteSize`),
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

function readDialogueContentV3(value: unknown, path: string): DialogueV3['content'] {
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
        width: readPositiveNumber(raw.width, `${path}.width`),
        height: readPositiveNumber(raw.height, `${path}.height`),
      }

    case 'video':
      return {
        kind: 'video',
        file: readMediaFile(raw.file, `${path}.file`),
        width: readPositiveNumber(raw.width, `${path}.width`),
        height: readPositiveNumber(raw.height, `${path}.height`),
        durationMs: readNonNegativeNumber(raw.durationMs, `${path}.durationMs`),
      }

    default:
      throw new SchemaError(`${path}.kind`, 'one of text, image, gif, video')
  }
}

function readDialogueMedia(value: unknown, path: string): DialogueMedia {
  const raw = readObject(value, path)
  const id = readMediaId(raw.id, `${path}.id`)
  const kind = readString(raw.kind, `${path}.kind`)
  switch (kind) {
    case 'image':
    case 'gif':
      return {
        id,
        kind,
        file: readMediaFile(raw.file, `${path}.file`),
        width: readPositiveNumber(raw.width, `${path}.width`),
        height: readPositiveNumber(raw.height, `${path}.height`),
      }

    case 'video':
      return {
        id,
        kind: 'video',
        file: readMediaFile(raw.file, `${path}.file`),
        width: readPositiveNumber(raw.width, `${path}.width`),
        height: readPositiveNumber(raw.height, `${path}.height`),
        durationMs: readNonNegativeNumber(raw.durationMs, `${path}.durationMs`),
      }

    default:
      throw new SchemaError(`${path}.kind`, 'one of image, gif, video')
  }
}

function readPixelRect(value: unknown, path: string): PixelRect {
  const raw = readObject(value, path)
  return {
    x: readNumber(raw.x, `${path}.x`),
    y: readNumber(raw.y, `${path}.y`),
    width: readPositiveNumber(raw.width, `${path}.width`),
    height: readPositiveNumber(raw.height, `${path}.height`),
  }
}

function readGlyph(value: unknown, path: string): Glyph {
  const raw = readObject(value, path)
  return {
    char: readString(raw.char, `${path}.char`),
    bits: readString(raw.bits, `${path}.bits`),
  }
}

function readCaptureProfile(value: unknown, path: string): CaptureProfile {
  const raw = readObject(value, path)
  return {
    id: readCaptureProfileId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    frameWidth: readPositiveNumber(raw.frameWidth, `${path}.frameWidth`),
    frameHeight: readPositiveNumber(raw.frameHeight, `${path}.frameHeight`),
    screenRect: readPixelRect(raw.screenRect, `${path}.screenRect`),
    nativeWidth: readPositiveNumber(raw.nativeWidth, `${path}.nativeWidth`),
    nativeHeight: readPositiveNumber(raw.nativeHeight, `${path}.nativeHeight`),
    textRect: readPixelRect(raw.textRect, `${path}.textRect`),
    glyphs: readArray(raw.glyphs, `${path}.glyphs`).map((glyph, index) =>
      readGlyph(glyph, `${path}.glyphs[${index}]`),
    ),
  }
}

function readGameMapV1(value: unknown, path: string): GameMapV1 {
  const raw = readObject(value, path)
  return {
    id: readMapId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    file: readMediaFile(raw.file, `${path}.file`),
    width: readPositiveNumber(raw.width, `${path}.width`),
    height: readPositiveNumber(raw.height, `${path}.height`),
  }
}

function readGameMap(value: unknown, path: string): GameMap {
  const raw = readObject(value, path)
  return {
    ...readGameMapV1(value, path),
    origin: readPoint(raw.origin, `${path}.origin`),
    // Clamped, not rejected, and through the very function the reducer uses: a hand-typed
    // `scale: 0` makes `canvasRectToMapLocal` return an Infinity rect, which culls every pin
    // on that map and puts every click nowhere — a dead map with no error to act on. One
    // policy, one place, so a nudge in the UI and a hand edit cannot disagree.
    scale: clampMapScale(readNumber(raw.scale, `${path}.scale`)),
  }
}

function readZone(value: unknown, path: string): Zone {
  const raw = readObject(value, path)
  return {
    id: readZoneId(raw.id, `${path}.id`),
    mapId: readMapId(raw.mapId, `${path}.mapId`),
    name: readString(raw.name, `${path}.name`),
    polygon: readPolygon(raw.polygon, `${path}.polygon`),
    hue: readHue(raw.hue, `${path}.hue`),
  }
}

/** The fields every dialogue version shares; only the content differs between V3 and V4. */
function readDialogueCommon(
  raw: Record<string, unknown>,
  path: string,
): Omit<Dialogue, 'text' | 'media'> {
  return {
    id: readDialogueId(raw.id, `${path}.id`),
    mapId: readMapId(raw.mapId, `${path}.mapId`),
    npcName: readString(raw.npcName, `${path}.npcName`),
    position: readPoint(raw.position, `${path}.position`),
    spokenAt: readInstant(raw.spokenAt, `${path}.spokenAt`),
    relevance: readRelevance(raw.relevance, `${path}.relevance`),
  }
}

function readDialogue(value: unknown, path: string): Dialogue {
  const raw = readObject(value, path)
  return {
    ...readDialogueCommon(raw, path),
    text: readString(raw.text, `${path}.text`),
    media: readMedia(raw.media, `${path}.media`),
  }
}

/**
 * A `MediaId` is what a remove or a reorder addresses, so two media sharing one inside a
 * single dialogue is the same defect duplicate dialogue ids are — removing either takes both.
 */
function readMedia(value: unknown, path: string): DialogueMedia[] {
  const media = readArray(value, path).map((medium, index) =>
    readDialogueMedia(medium, `${path}[${index}]`),
  )
  assertUniqueIds(media, path)
  return media
}

function readDialogueV3(value: unknown, path: string): DialogueV3 {
  const raw = readObject(value, path)
  return {
    ...readDialogueCommon(raw, path),
    content: readDialogueContentV3(raw.content, `${path}.content`),
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
    hue: readHue(raw.hue, `${path}.hue`),
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
function readProjectFile(value: unknown): { file: ProjectFile; repairs: ProjectRepairs } {
  const raw = readObject(value, 'data.json')
  const repaired = repairReferences(readVersionedProjectFile(raw))
  // After the repair, not before: a record that is about to be dropped must not be able to
  // reject the document it is no longer part of.
  assertUniqueFileNames(repaired.file)
  return repaired
}

/**
 * The no-dangling-ids invariant every reader downstream relies on — `reducer.ts` guards the
 * edges it owns, and this is the other way a reference could enter the document.
 *
 * Repair, not rejection: a project with one stray record should open minus the record, because
 * stranding a whole folder over one bad line is the worse failure. The record is dropped rather
 * than adopted by some other map, since there is no honest answer to which map it belonged to,
 * and a dialogue on a map that no longer exists is already invisible and undeletable —
 * `groupByMap` skips it while every save writes it back out.
 *
 * The repaired document is only in memory; it reaches `media/` and `data.json` on the next save
 * like any other edit.
 */
function repairReferences(file: ProjectFile): { file: ProjectFile; repairs: ProjectRepairs } {
  const mapIds = new Set<MapId>(file.maps.map((map) => map.id))
  const dialogues = file.dialogues.filter((dialogue) => mapIds.has(dialogue.mapId))
  const zones = file.zones.filter((zone) => mapIds.has(zone.mapId))

  // Against the *surviving* dialogues, so a quest reference to a dialogue dropped one line
  // above goes with it — the two repairs are one pass, not two independent ones.
  const dialogueIds = new Set<DialogueId>(dialogues.map((dialogue) => dialogue.id))
  let questDialogueIds = 0
  const quests = file.quests.map((quest) => {
    const kept = quest.dialogueIds.filter((id) => dialogueIds.has(id))
    if (kept.length === quest.dialogueIds.length) return quest
    questDialogueIds += quest.dialogueIds.length - kept.length
    return { ...quest, dialogueIds: kept }
  })

  const droppedDialogues = file.dialogues.length - dialogues.length
  const droppedZones = file.zones.length - zones.length
  if (droppedDialogues === 0 && droppedZones === 0 && questDialogueIds === 0) {
    return { file, repairs: { kind: 'none' } }
  }
  return {
    file: { ...file, dialogues, zones, quests },
    repairs: {
      kind: 'repaired',
      dialogues: droppedDialogues,
      zones: droppedZones,
      questDialogueIds,
    },
  }
}

/**
 * Every file in `media/` is named by exactly one record. Two records naming one file makes a
 * delete destructive: removing either dialogue takes the bytes the other still points at, and
 * `deleteMediaFile` cannot tell the difference. Maps live in `media/` too (`map-<id>.<ext>`),
 * so they share the namespace and are checked with it.
 *
 * Run on the migrated document rather than per version, which is why a V1–V3 file reports the
 * V4 path `dialogues[i].media[0]` for what it stores as `dialogues[i].content` — the file name
 * in the message is what identifies the line to fix either way.
 */
function assertUniqueFileNames(file: ProjectFile): void {
  const seen = new Set<string>()
  const claim = (fileName: string, path: string): void => {
    if (seen.has(fileName)) {
      throw new SchemaError(path, `a file no other record names, but "${fileName}" is taken`)
    }
    seen.add(fileName)
  }
  file.maps.forEach((map, index) => claim(map.file.fileName, `maps[${index}].file.fileName`))
  file.dialogues.forEach((dialogue, dialogueIndex) => {
    dialogue.media.forEach((medium, mediaIndex) => {
      claim(
        medium.file.fileName,
        `dialogues[${dialogueIndex}].media[${mediaIndex}].file.fileName`,
      )
    })
  })
}

function readVersionedProjectFile(raw: Record<string, unknown>): ProjectFile {
  const schemaVersion = readNumber(raw.schemaVersion, 'schemaVersion')
  switch (schemaVersion) {
    case 1:
      return migrateV3(migrateV2(migrateV1(readProjectFileV1(raw))))
    case 2:
      return migrateV3(migrateV2(readProjectFileV2(raw)))
    case 3:
      return migrateV3(readProjectFileV3(raw))
    case 4:
      return readProjectFileV4(raw)
    default:
      throw new SchemaError('schemaVersion', `1, 2, 3 or 4, but found ${String(schemaVersion)}`)
  }
}

/** `maps`, `dialogues` and `quests` differ per version; the rest is read by the same functions. */
function readCommonFields(
  raw: Record<string, unknown>,
): { projectName: string; savedAt: string; zones: Zone[] } {
  return {
    projectName: readString(raw.projectName, 'projectName'),
    savedAt: readInstant(raw.savedAt, 'savedAt'),
    zones: readUniqueArray(raw, 'zones', readZone),
  }
}

function readDialoguesV3(raw: Record<string, unknown>): DialogueV3[] {
  return readUniqueArray(raw, 'dialogues', readDialogueV3)
}

function readQuestsV2(raw: Record<string, unknown>): QuestV2[] {
  return readUniqueArray(raw, 'quests', readQuestV2)
}

function readProjectFileV1(raw: Record<string, unknown>): ProjectFileV1 {
  return {
    schemaVersion: 1,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMapV1),
    dialogues: readDialoguesV3(raw),
    quests: readQuestsV2(raw),
  }
}

function readProjectFileV2(raw: Record<string, unknown>): ProjectFileV2 {
  return {
    schemaVersion: 2,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues: readDialoguesV3(raw),
    quests: readQuestsV2(raw),
  }
}

function readProjectFileV3(raw: Record<string, unknown>): ProjectFileV3 {
  return {
    schemaVersion: 3,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues: readDialoguesV3(raw),
    quests: readQuestsV3(raw),
  }
}

function readProjectFileV4(raw: Record<string, unknown>): ProjectFile {
  return {
    schemaVersion: 4,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues: readUniqueArray(raw, 'dialogues', readDialogue),
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfile),
  }
}

function readQuestsV3(raw: Record<string, unknown>): Quest[] {
  return readUniqueArray(raw, 'quests', readQuest)
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
function migrateV2(file: ProjectFileV2): ProjectFileV3 {
  const quests: Quest[] = []
  for (const quest of file.quests) {
    quests.push({ ...quest, hue: nextQuestHue(quests) })
  }
  return { ...file, schemaVersion: 3, quests }
}

/**
 * V3 held either text or exactly one file per dialogue. The text case becomes a line with no
 * pictures, and each media case a picture with no line — which is what those documents already
 * meant. `fileName` is carried over verbatim rather than renamed to the V4 scheme: a migration
 * is pure and cannot touch `media/`, and the name has always been stored rather than derived.
 */
function migrateV3(file: ProjectFileV3): ProjectFile {
  return {
    ...file,
    schemaVersion: 4,
    dialogues: file.dialogues.map(migrateDialogueV3),
    captureProfiles: [],
  }
}

function migrateDialogueV3(dialogue: DialogueV3): Dialogue {
  const { content, ...rest } = dialogue
  if (content.kind === 'text') return { ...rest, text: content.text, media: [] }
  // `id` first, matching the order `readDialogueMedia` builds a medium in. JSON.stringify
  // writes keys in insertion order, so spreading `content` first would make a migrated
  // project's first save differ from every save after it — a whole-file diff, once, for
  // nothing. See the byte-stability test in data-file.test.ts.
  return { ...rest, text: '', media: [{ id: newMediaId(), ...content }] }
}

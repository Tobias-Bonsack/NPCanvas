import { defaultRelevanceTags } from '../dialogue/relevance.ts'
import { clampMapScale, nextMapOrigin } from '../map/canvas-layout.ts'
import { nextQuestHue } from '../quest/quest-style.ts'
import {
  asCaptureProfileId,
  asDialogueId,
  asMapId,
  asMediaId,
  asPendingCaptureId,
  asQuestId,
  asRelevanceTagId,
  asZoneId,
  newMediaId,
} from './ids.ts'
import type {
  CaptureProfile,
  CaptureProfileId,
  CaptureProfileV5,
  CaptureProfileV7,
  Dialogue,
  DialogueId,
  DialogueMedia,
  DialogueV3,
  DialogueV4,
  GameMap,
  GameMapV1,
  Glyph,
  MapId,
  MediaFile,
  MediaId,
  PendingCapture,
  PendingCaptureId,
  PixelRect,
  Point,
  Polygon,
  ProjectFile,
  ProjectFileV1,
  ProjectFileV2,
  ProjectFileV3,
  ProjectFileV4,
  ProjectFileV5,
  ProjectFileV6,
  ProjectFileV7,
  ProjectFileV8,
  ProjectRepairs,
  Quest,
  QuestId,
  QuestStatus,
  QuestV2,
  RelevanceSlugV4,
  RelevanceTag,
  RelevanceTagId,
  Zone,
  ZoneId,
} from './types.ts'
import { QUEST_STATUSES, RELEVANCE_SLUGS_V4 } from './types.ts'

/** The document written to `<project>/data.json` when a folder is first connected. */
export function createEmptyProject(name: string): ProjectFile {
  return {
    schemaVersion: 8,
    projectName: name,
    savedAt: new Date().toISOString(),
    maps: [],
    zones: [],
    dialogues: [],
    quests: [],
    captureProfiles: [],
    relevanceTags: defaultRelevanceTags(),
    glyphs: [],
    pendingCaptures: [],
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

function readPendingCaptureId(value: unknown, path: string): PendingCaptureId {
  return asPendingCaptureId(readString(value, path))
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

/** A V1–V4 dialogue's relevance: slugs against the compiled-in `RELEVANCE_SLUGS_V4` vocabulary. */
function readRelevanceV4(value: unknown, path: string): RelevanceSlugV4[] {
  const raw = readArray(value, path)
  const found = raw.map((tag, index) => {
    const text = readString(tag, `${path}[${index}]`)
    if (!isRelevanceSlugV4(text)) {
      throw new SchemaError(`${path}[${index}]`, `one of ${RELEVANCE_SLUGS_V4.join(', ')}`)
    }
    return text
  })
  // Rebuilt from RELEVANCE_SLUGS_V4 rather than returned as read, which enforces the
  // "deduplicated, in RELEVANCE_SLUGS_V4 order" invariant on a hand-edited file too.
  return RELEVANCE_SLUGS_V4.filter((tag) => found.includes(tag))
}

function isRelevanceSlugV4(value: string): value is RelevanceSlugV4 {
  return (RELEVANCE_SLUGS_V4 as readonly string[]).includes(value)
}

/**
 * A V5 dialogue's relevance: ids against the project's own `relevanceTags`. Known ids come back
 * in `tagOrder`'s canonical order; anything unrecognised trails after them rather than being
 * rejected here — `repairReferences` is what counts and drops a tag id that names nothing,
 * exactly as it already does for a dangling `mapId` or quest reference.
 */
function readRelevanceV5(
  value: unknown,
  path: string,
  tagOrder: readonly RelevanceTagId[],
): RelevanceTagId[] {
  const raw = readArray(value, path)
  const found = new Set(
    raw.map((tag, index) => asRelevanceTagId(readString(tag, `${path}[${index}]`))),
  )
  const known = tagOrder.filter((id) => found.has(id))
  const unknown = [...found].filter((id) => !tagOrder.includes(id))
  return [...known, ...unknown]
}

function readRelevanceTagId(value: unknown, path: string): RelevanceTagId {
  return asRelevanceTagId(readString(value, path))
}

function readRelevanceTag(value: unknown, path: string): RelevanceTag {
  const raw = readObject(value, path)
  return {
    id: readRelevanceTagId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    hue: readHue(raw.hue, `${path}.hue`),
  }
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

function readGlyphs(value: unknown, path: string): Glyph[] {
  return readArray(value, path).map((glyph, index) => readGlyph(glyph, `${path}[${index}]`))
}

function readCaptureProfile(value: unknown, path: string): CaptureProfile {
  const raw = readObject(value, path)
  return {
    ...readCaptureProfileV7(value, path),
    battleRect:
      raw.battleRect === null || raw.battleRect === undefined
        ? null
        : readPixelRect(raw.battleRect, `${path}.battleRect`),
  }
}

/**
 * A V6-and-V7 profile, before the gauge was measured. Kept beside `readCaptureProfileV5` as the
 * pre-migration reader, and used by `readCaptureProfile` for the fields the two share — the
 * measurement `battleRect` adds is appended *after* them, so a migrated document's first save
 * writes the keys in the order every save after it does.
 */
function readCaptureProfileV7(value: unknown, path: string): CaptureProfileV7 {
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
  }
}

/**
 * A V5-and-earlier profile, alphabet and all. `glyphs` is appended *after* the shared fields so a
 * migrated document's first save writes the keys in the order every save after it does — the
 * byte-stability the round-trip test pins.
 */
function readCaptureProfileV5(value: unknown, path: string): CaptureProfileV5 {
  const raw = readObject(value, path)
  return {
    ...readCaptureProfileV7(value, path),
    glyphs: readGlyphs(raw.glyphs, `${path}.glyphs`),
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

/** The fields every dialogue version shares; only `relevance` and the content differ by version. */
function readDialogueCommon<R>(
  raw: Record<string, unknown>,
  path: string,
  readRelevanceField: (value: unknown, path: string) => R,
): {
  id: DialogueId
  mapId: MapId
  npcName: string
  position: Point
  spokenAt: string
  relevance: R
} {
  return {
    id: readDialogueId(raw.id, `${path}.id`),
    mapId: readMapId(raw.mapId, `${path}.mapId`),
    npcName: readString(raw.npcName, `${path}.npcName`),
    position: readPoint(raw.position, `${path}.position`),
    spokenAt: readInstant(raw.spokenAt, `${path}.spokenAt`),
    relevance: readRelevanceField(raw.relevance, `${path}.relevance`),
  }
}

function readDialogueV4(value: unknown, path: string): DialogueV4 {
  const raw = readObject(value, path)
  return {
    ...readDialogueCommon(raw, path, readRelevanceV4),
    text: readString(raw.text, `${path}.text`),
    media: readMedia(raw.media, `${path}.media`),
  }
}

function readDialogue(value: unknown, path: string, tagOrder: readonly RelevanceTagId[]): Dialogue {
  const raw = readObject(value, path)
  return {
    ...readDialogueCommon(raw, path, (v, p) => readRelevanceV5(v, p, tagOrder)),
    text: readString(raw.text, `${path}.text`),
    media: readMedia(raw.media, `${path}.media`),
  }
}

/** Everything a `Dialogue` is read as, minus `mapId` and `position` — see `PendingCapture`. */
function readPendingCapture(
  value: unknown,
  path: string,
  tagOrder: readonly RelevanceTagId[],
): PendingCapture {
  const raw = readObject(value, path)
  return {
    id: readPendingCaptureId(raw.id, `${path}.id`),
    npcName: readString(raw.npcName, `${path}.npcName`),
    text: readString(raw.text, `${path}.text`),
    media: readMedia(raw.media, `${path}.media`),
    spokenAt: readInstant(raw.spokenAt, `${path}.spokenAt`),
    relevance: readRelevanceV5(raw.relevance, `${path}.relevance`, tagOrder),
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
    ...readDialogueCommon(raw, path, readRelevanceV4),
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
  const survivingDialogues = file.dialogues.filter((dialogue) => mapIds.has(dialogue.mapId))
  const zones = file.zones.filter((zone) => mapIds.has(zone.mapId))

  // Against the *surviving* dialogues, so a quest reference to a dialogue dropped one line
  // above goes with it — the two repairs are one pass, not two independent ones.
  const dialogueIds = new Set<DialogueId>(survivingDialogues.map((dialogue) => dialogue.id))
  let questDialogueIds = 0
  const quests = file.quests.map((quest) => {
    const kept = quest.dialogueIds.filter((id) => dialogueIds.has(id))
    if (kept.length === quest.dialogueIds.length) return quest
    questDialogueIds += quest.dialogueIds.length - kept.length
    return { ...quest, dialogueIds: kept }
  })

  // Every id readRelevanceV5 read is already normalised into canonical order; only ids naming
  // no current tag need dropping, and readRelevanceV5 trails those after the known ones.
  const tagIds = new Set<RelevanceTagId>(file.relevanceTags.map((tag) => tag.id))
  let relevance = 0
  const dialogues = survivingDialogues.map((dialogue) => {
    const kept = dialogue.relevance.filter((id) => tagIds.has(id))
    if (kept.length === dialogue.relevance.length) return dialogue
    relevance += dialogue.relevance.length - kept.length
    return { ...dialogue, relevance: kept }
  })

  // A pending capture carries no `mapId`, so it has nothing to be orphaned from — only its
  // relevance ids can dangle, repaired the same way and folded into the same count.
  const pendingCaptures = file.pendingCaptures.map((capture) => {
    const kept = capture.relevance.filter((id) => tagIds.has(id))
    if (kept.length === capture.relevance.length) return capture
    relevance += capture.relevance.length - kept.length
    return { ...capture, relevance: kept }
  })

  const droppedDialogues = file.dialogues.length - dialogues.length
  const droppedZones = file.zones.length - zones.length
  if (droppedDialogues === 0 && droppedZones === 0 && questDialogueIds === 0 && relevance === 0) {
    return { file, repairs: { kind: 'none' } }
  }
  return {
    file: { ...file, dialogues, zones, quests, pendingCaptures },
    repairs: {
      kind: 'repaired',
      dialogues: droppedDialogues,
      zones: droppedZones,
      questDialogueIds,
      relevance,
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
  file.pendingCaptures.forEach((capture, captureIndex) => {
    capture.media.forEach((medium, mediaIndex) => {
      claim(
        medium.file.fileName,
        `pendingCaptures[${captureIndex}].media[${mediaIndex}].file.fileName`,
      )
    })
  })
}

function readVersionedProjectFile(raw: Record<string, unknown>): ProjectFile {
  const schemaVersion = readNumber(raw.schemaVersion, 'schemaVersion')
  switch (schemaVersion) {
    case 1:
      return migrateV7(
        migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(migrateV1(readProjectFileV1(raw))))))),
      )
    case 2:
      return migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(readProjectFileV2(raw)))))))
    case 3:
      return migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(readProjectFileV3(raw))))))
    case 4:
      return migrateV7(migrateV6(migrateV5(migrateV4(readProjectFileV4(raw)))))
    case 5:
      return migrateV7(migrateV6(migrateV5(readProjectFileV5(raw))))
    case 6:
      return migrateV7(migrateV6(readProjectFileV6(raw)))
    case 7:
      return migrateV7(readProjectFileV7(raw))
    case 8:
      return readProjectFileV8(raw)
    default:
      throw new SchemaError(
        'schemaVersion',
        `1, 2, 3, 4, 5, 6, 7 or 8, but found ${String(schemaVersion)}`,
      )
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

function readProjectFileV4(raw: Record<string, unknown>): ProjectFileV4 {
  return {
    schemaVersion: 4,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues: readUniqueArray(raw, 'dialogues', readDialogueV4),
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfileV5),
  }
}

/**
 * V5 reads `relevanceTags` first: its order is what `readDialogue` normalizes every dialogue's
 * relevance ids against, so the tag list has to exist before a single dialogue can be read.
 */
function readProjectFileV5(raw: Record<string, unknown>): ProjectFileV5 {
  const relevanceTags = readUniqueArray(raw, 'relevanceTags', readRelevanceTag)
  const tagOrder = relevanceTags.map((tag) => tag.id)
  const dialogues = readArray(raw.dialogues, 'dialogues').map((item, index) =>
    readDialogue(item, `dialogues[${index}]`, tagOrder),
  )
  assertUniqueIds(dialogues, 'dialogues')
  return {
    schemaVersion: 5,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues,
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfileV5),
    relevanceTags,
  }
}

/**
 * V6 reads the project's own alphabet after everything else, which is the order it is written in.
 * Otherwise identical to V5 — moving `glyphs` off the profiles changed nothing a dialogue or a
 * zone is read by.
 */
function readProjectFileV6(raw: Record<string, unknown>): ProjectFileV6 {
  const relevanceTags = readUniqueArray(raw, 'relevanceTags', readRelevanceTag)
  const tagOrder = relevanceTags.map((tag) => tag.id)
  const dialogues = readArray(raw.dialogues, 'dialogues').map((item, index) =>
    readDialogue(item, `dialogues[${index}]`, tagOrder),
  )
  assertUniqueIds(dialogues, 'dialogues')
  return {
    schemaVersion: 6,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues,
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfileV7),
    relevanceTags,
    glyphs: readGlyphs(raw.glyphs, 'glyphs'),
  }
}

/**
 * V7 reads `pendingCaptures` last, against the same `tagOrder` `dialogues` already normalized
 * relevance ids against — a capture's relevance is read no differently than a dialogue's.
 * Otherwise identical to V6.
 */
function readProjectFileV7(raw: Record<string, unknown>): ProjectFileV7 {
  const relevanceTags = readUniqueArray(raw, 'relevanceTags', readRelevanceTag)
  const tagOrder = relevanceTags.map((tag) => tag.id)
  const dialogues = readArray(raw.dialogues, 'dialogues').map((item, index) =>
    readDialogue(item, `dialogues[${index}]`, tagOrder),
  )
  assertUniqueIds(dialogues, 'dialogues')
  const pendingCaptures = readUniqueArray(raw, 'pendingCaptures', (item, path) =>
    readPendingCapture(item, path, tagOrder),
  )
  return {
    schemaVersion: 7,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues,
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfileV7),
    relevanceTags,
    glyphs: readGlyphs(raw.glyphs, 'glyphs'),
    pendingCaptures,
  }
}

/**
 * V8 reads the profile shape that carries `battleRect`. Otherwise identical to V7 — the gauge is
 * the only thing this version adds, and it adds it to the profile rather than to the document.
 */
function readProjectFileV8(raw: Record<string, unknown>): ProjectFileV8 {
  const relevanceTags = readUniqueArray(raw, 'relevanceTags', readRelevanceTag)
  const tagOrder = relevanceTags.map((tag) => tag.id)
  const dialogues = readArray(raw.dialogues, 'dialogues').map((item, index) =>
    readDialogue(item, `dialogues[${index}]`, tagOrder),
  )
  assertUniqueIds(dialogues, 'dialogues')
  const pendingCaptures = readUniqueArray(raw, 'pendingCaptures', (item, path) =>
    readPendingCapture(item, path, tagOrder),
  )
  return {
    schemaVersion: 8,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues,
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfile),
    relevanceTags,
    glyphs: readGlyphs(raw.glyphs, 'glyphs'),
    pendingCaptures,
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
function migrateV3(file: ProjectFileV3): ProjectFileV4 {
  return {
    ...file,
    schemaVersion: 4,
    dialogues: file.dialogues.map(migrateDialogueV3),
    captureProfiles: [],
  }
}

function migrateDialogueV3(dialogue: DialogueV3): DialogueV4 {
  const { content, ...rest } = dialogue
  if (content.kind === 'text') return { ...rest, text: content.text, media: [] }
  // `id` first, matching the order `readDialogueMedia` builds a medium in. JSON.stringify
  // writes keys in insertion order, so spreading `content` first would make a migrated
  // project's first save differ from every save after it — a whole-file diff, once, for
  // nothing. See the byte-stability test in data-file.test.ts.
  return { ...rest, text: '', media: [{ id: newMediaId(), ...content }] }
}

/**
 * V4 compiled the relevance vocabulary in; V5 moves it into the document. The four tags are
 * built once, via the same `defaultRelevanceTags` a brand new project seeds — which is what
 * makes a migrated project and a fresh one indistinguishable — and every dialogue's slugs are
 * rewritten into the matching ids. `RELEVANCE_SLUGS_V4.indexOf` is safe here because
 * `defaultRelevanceTags` returns its four tags in that exact order.
 */
function migrateV4(file: ProjectFileV4): ProjectFileV5 {
  const relevanceTags = defaultRelevanceTags()
  return {
    ...file,
    schemaVersion: 5,
    dialogues: file.dialogues.map((dialogue) => ({
      ...dialogue,
      relevance: dialogue.relevance.map(
        (slug) => relevanceTags[RELEVANCE_SLUGS_V4.indexOf(slug)].id,
      ),
    })),
    relevanceTags,
  }
}

/**
 * V5 gave every capture profile an alphabet of its own; V6 gives the project one. The profiles'
 * alphabets are folded together in profile order, and the **first** naming of a bitmap wins.
 *
 * Deliberately not `mergeGlyphs`: that replaces on identical bits, so the last profile taught
 * would overrule every earlier one. Profiles are appended in the order they were created, which is
 * the order they were taught in, and the fullest alphabet is the one that was taught first — a
 * later profile aimed at a second box on the same console is re-learning tiles, not correcting
 * them. Where the two disagree the earlier answer is the one with the most readings behind it.
 * A disagreement is now fixable in the UI either way, which is what makes this a rule rather than
 * a guess: `forgetGlyph` plus the learner replaces a wrong entry in two clicks.
 */
function migrateV5(file: ProjectFileV5): ProjectFileV6 {
  const glyphs: Glyph[] = []
  const known = new Set<string>()
  for (const profile of file.captureProfiles) {
    for (const glyph of profile.glyphs) {
      if (known.has(glyph.bits)) continue
      known.add(glyph.bits)
      glyphs.push(glyph)
    }
  }
  return {
    ...file,
    schemaVersion: 6,
    captureProfiles: file.captureProfiles.map(stripGlyphs),
    glyphs,
  }
}

/** A V5 profile as V6 stores it. Written out field by field rather than destructured, because
 * `noUnusedLocals` fails on the binding a rest-spread would leave behind. */
function stripGlyphs(profile: CaptureProfileV5): CaptureProfileV7 {
  return {
    id: profile.id,
    name: profile.name,
    frameWidth: profile.frameWidth,
    frameHeight: profile.frameHeight,
    screenRect: profile.screenRect,
    nativeWidth: profile.nativeWidth,
    nativeHeight: profile.nativeHeight,
    textRect: profile.textRect,
  }
}

/**
 * V6 had no way to record a conversation before it had a place to be. V7 adds the empty list —
 * nothing before this version could have written a `PendingCapture`, so there is nothing to
 * carry over.
 */
function migrateV6(file: ProjectFileV6): ProjectFileV7 {
  return { ...file, schemaVersion: 7, pendingCaptures: [] }
}

/**
 * V7 could not tell a fight from a conversation, because nothing in a profile said where the
 * opponent's status gauge is drawn. V8 adds that measurement, and there is nothing to derive it
 * from: a rectangle guessed here would be a confident claim about a console this project may not
 * even be aimed at. `null` says it has not been measured, and the watcher then behaves exactly as
 * it did under V7.
 */
function migrateV7(file: ProjectFileV7): ProjectFileV8 {
  return {
    ...file,
    schemaVersion: 8,
    captureProfiles: file.captureProfiles.map((profile) => ({ ...profile, battleRect: null })),
  }
}

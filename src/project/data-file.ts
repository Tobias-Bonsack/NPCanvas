import { defaultRelevanceTags } from '../dialogue/relevance.ts'
import { clampMapScale } from '../map/canvas-layout.ts'
import {
  readCaptureProfileV7,
  readGameMapV1,
  readQuestV2,
  readVersionedProjectFile,
} from './data-file-migrations.ts'
import {
  asCaptureProfileId,
  asDialogueId,
  asMapId,
  asMediaId,
  asPendingCaptureId,
  asQuestId,
  asRelevanceTagId,
  asZoneId,
} from './ids.ts'
import type {
  CaptureProfile,
  CaptureProfileId,
  Dialogue,
  DialogueId,
  DialogueMedia,
  GameMap,
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
  ProjectRepairs,
  Quest,
  QuestId,
  QuestStatus,
  RecorderAction,
  RecorderBinding,
  RelevanceTag,
  RelevanceTagId,
  Zone,
  ZoneId,
} from './types.ts'
import { QUEST_STATUSES, RECORDER_ACTIONS } from './types.ts'

/** The document written to `<project>/data.json` when a folder is first connected. */
export function createEmptyProject(name: string): ProjectFile {
  return {
    schemaVersion: 11,
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
    // No default binding — see RecorderBinding: a guessed one would claim a button on a
    // controller this project has never seen means "record".
    recorderBindings: [],
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
export class SchemaError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`)
    this.name = 'SchemaError'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---- primitives ----
//
// Shared by both this file's current-version readers and every pre-migration reader in
// `data-file-migrations.ts` — kept in this one place so a version's shape never has two
// competing readers for the same primitive.

export function readObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaError(path, 'an object')
  }
  return value as Record<string, unknown>
}

export function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(path, 'an array')
  return value
}

export function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SchemaError(path, 'a string')
  return value
}

export function readNumber(value: unknown, path: string): number {
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
export function readPositiveNumber(value: unknown, path: string): number {
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
export function readNonNegativeNumber(value: unknown, path: string): number {
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
export function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      throw new SchemaError(`${path}[${index}].id`, `an id not already used, but "${item.id}" is`)
    }
    seen.add(item.id)
  })
}

/** Reads an array of records and rejects the whole document if two of them share an id. */
export function readUniqueArray<T extends { id: string }>(
  raw: Record<string, unknown>,
  key: string,
  read: (value: unknown, path: string) => T,
): T[] {
  const items = readArray(raw[key], key).map((item, index) => read(item, `${key}[${index}]`))
  assertUniqueIds(items, key)
  return items
}

export function readMapId(value: unknown, path: string): MapId {
  return asMapId(readString(value, path))
}

function readZoneId(value: unknown, path: string): ZoneId {
  return asZoneId(readString(value, path))
}

export function readDialogueId(value: unknown, path: string): DialogueId {
  return asDialogueId(readString(value, path))
}

export function readQuestId(value: unknown, path: string): QuestId {
  return asQuestId(readString(value, path))
}

function readMediaId(value: unknown, path: string): MediaId {
  return asMediaId(readString(value, path))
}

export function readCaptureProfileId(value: unknown, path: string): CaptureProfileId {
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

export function readMediaFile(value: unknown, path: string): MediaFile {
  const raw = readObject(value, path)
  return {
    fileName: readString(raw.fileName, `${path}.fileName`),
    mimeType: readString(raw.mimeType, `${path}.mimeType`),
    byteSize: readPositiveNumber(raw.byteSize, `${path}.byteSize`),
  }
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

export function readRelevanceTag(value: unknown, path: string): RelevanceTag {
  const raw = readObject(value, path)
  return {
    id: readRelevanceTagId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    hue: readHue(raw.hue, `${path}.hue`),
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

export function readPixelRect(value: unknown, path: string): PixelRect {
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

export function readGlyphs(value: unknown, path: string): Glyph[] {
  return readArray(value, path).map((glyph, index) => readGlyph(glyph, `${path}[${index}]`))
}

/** A button index: never negative, never fractional — it addresses `Gamepad.buttons`. */
function readNonNegativeInteger(value: unknown, path: string): number {
  const number = readNumber(value, path)
  if (!Number.isInteger(number) || number < 0) {
    throw new SchemaError(path, 'a non-negative integer')
  }
  return number
}

function readRecorderAction(value: unknown, path: string): RecorderAction {
  const action = readString(value, path)
  if (!isRecorderAction(action)) throw new SchemaError(path, RECORDER_ACTIONS.join(' or '))
  return action
}

function isRecorderAction(value: string): value is RecorderAction {
  return (RECORDER_ACTIONS as readonly string[]).includes(value)
}

function readRecorderBinding(value: unknown, path: string): RecorderBinding {
  const raw = readObject(value, path)
  return {
    action: readRecorderAction(raw.action, `${path}.action`),
    buttonIndex: readNonNegativeInteger(raw.buttonIndex, `${path}.buttonIndex`),
  }
}

/**
 * At most one binding per action, mirroring the reducer's own invariant — the first naming of an
 * action wins, so a hand-edited duplicate collapses rather than rejecting the whole document.
 */
export function readRecorderBindings(value: unknown, path: string): RecorderBinding[] {
  const bindings = readArray(value, path).map((binding, index) =>
    readRecorderBinding(binding, `${path}[${index}]`),
  )
  const seen = new Set<RecorderAction>()
  const result: RecorderBinding[] = []
  for (const binding of bindings) {
    if (seen.has(binding.action)) continue
    seen.add(binding.action)
    result.push(binding)
  }
  return result
}

/**
 * A V9 profile: exactly the fields `readCaptureProfileV7` already reads. V8's gauge measurement
 * had no reader left after #104, so V9 drops it and this is once again a plain pass-through.
 * `readCaptureProfileV7` is the pre-migration reader in `data-file-migrations.ts` — the shape
 * has not changed since, only the version whose document it belongs to has moved on.
 */
export function readCaptureProfile(value: unknown, path: string): CaptureProfile {
  return readCaptureProfileV7(value, path)
}

export function readGameMap(value: unknown, path: string): GameMap {
  const raw = readObject(value, path)
  return {
    // `readGameMapV1` is the pre-migration reader in `data-file-migrations.ts`: a current
    // `GameMap` is a V1 map plus placement, and the base fields have not changed shape since.
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
export function readDialogueCommon<R>(
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

export function readDialogue(
  value: unknown,
  path: string,
  tagOrder: readonly RelevanceTagId[],
): Dialogue {
  const raw = readObject(value, path)
  const common = readDialogueCommon(raw, path, (v, p) => readRelevanceV5(v, p, tagOrder))
  const references = (raw.references !== undefined ? readArray(raw.references, `${path}.references`) : []).map(
    (ref, index) => readDialogueId(ref, `${path}.references[${index}]`),
  )
  return {
    id: common.id,
    mapId: common.mapId,
    npcName: common.npcName,
    position: common.position,
    text: readString(raw.text, `${path}.text`),
    media: readMedia(raw.media, `${path}.media`),
    spokenAt: common.spokenAt,
    relevance: common.relevance,
    references,
  }
}

/** Everything a `Dialogue` is read as, minus `mapId` and `position` — see `PendingCapture`. */
export function readPendingCapture(
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
export function readMedia(value: unknown, path: string): DialogueMedia[] {
  const media = readArray(value, path).map((medium, index) =>
    readDialogueMedia(medium, `${path}[${index}]`),
  )
  assertUniqueIds(media, path)
  return media
}

/**
 * A current `Quest` is a V2 quest plus a colour. `readQuestV2` is the pre-migration reader in
 * `data-file-migrations.ts` — the shared fields have not changed shape since V2.
 */
function readQuest(value: unknown, path: string): Quest {
  const raw = readObject(value, path)
  return {
    ...readQuestV2(value, path),
    hue: readHue(raw.hue, `${path}.hue`),
  }
}

export function readQuestStatus(value: unknown, path: string): QuestStatus {
  const status = readString(value, path)
  if (!isQuestStatus(status)) throw new SchemaError(path, QUEST_STATUSES.join(' or '))
  return status
}

function isQuestStatus(value: string): value is QuestStatus {
  return (QUEST_STATUSES as readonly string[]).includes(value)
}

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
  let dialogueReferences = 0
  const dialogues = survivingDialogues.map((dialogue) => {
    const keptRelevance = dialogue.relevance.filter((id) => tagIds.has(id))
    const keptReferences = dialogue.references.filter((id) => dialogueIds.has(id) && id !== dialogue.id)
    const relevanceChanged = keptRelevance.length !== dialogue.relevance.length
    const referencesChanged = keptReferences.length !== dialogue.references.length
    if (!relevanceChanged && !referencesChanged) return dialogue
    if (relevanceChanged) relevance += dialogue.relevance.length - keptRelevance.length
    if (referencesChanged) dialogueReferences += dialogue.references.length - keptReferences.length
    return {
      ...dialogue,
      relevance: keptRelevance,
      references: keptReferences,
    }
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
  if (droppedDialogues === 0 && droppedZones === 0 && questDialogueIds === 0 && relevance === 0 && dialogueReferences === 0) {
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
      dialogueReferences,
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

/** `maps`, `dialogues` and `quests` differ per version; the rest is read by the same functions. */
export function readCommonFields(
  raw: Record<string, unknown>,
): { projectName: string; savedAt: string; zones: Zone[] } {
  return {
    projectName: readString(raw.projectName, 'projectName'),
    savedAt: readInstant(raw.savedAt, 'savedAt'),
    zones: readUniqueArray(raw, 'zones', readZone),
  }
}

/**
 * V10 reads `recorderBindings` last, after everything V9 already read. Otherwise identical to V9
 * — the bindings are the only thing this version adds, and it adds them to the document rather
 * than to any profile. Every version before it lives in `data-file-migrations.ts`, read only by
 * `readVersionedProjectFile` there.
 */
export function readProjectFileV11(raw: Record<string, unknown>): ProjectFile {
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
    schemaVersion: 11,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues,
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfile),
    relevanceTags,
    glyphs: readGlyphs(raw.glyphs, 'glyphs'),
    pendingCaptures,
    recorderBindings: readRecorderBindings(raw.recorderBindings, 'recorderBindings'),
  }
}

export function readQuestsV3(raw: Record<string, unknown>): Quest[] {
  return readUniqueArray(raw, 'quests', readQuest)
}

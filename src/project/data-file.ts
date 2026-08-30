import { defaultRelevanceTags } from '../dialogue/relevance.ts'
import { clampMapScale } from '../map/canvas-layout.ts'
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

/**
 * A dialogue's relevance: ids against the project's own `relevanceTags`. Known ids come back
 * in `tagOrder`'s canonical order; anything unrecognised trails after them rather than being
 * rejected here — `repairReferences` is what counts and drops a tag id that names nothing,
 * exactly as it already does for a dangling `mapId` or quest reference.
 */
function readRelevance(
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
function readRecorderBindings(value: unknown, path: string): RecorderBinding[] {
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
  }
}

function readGameMap(value: unknown, path: string): GameMap {
  const raw = readObject(value, path)
  return {
    id: readMapId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    file: readMediaFile(raw.file, `${path}.file`),
    width: readPositiveNumber(raw.width, `${path}.width`),
    height: readPositiveNumber(raw.height, `${path}.height`),
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

function readDialogue(value: unknown, path: string, tagOrder: readonly RelevanceTagId[]): Dialogue {
  const raw = readObject(value, path)
  return {
    id: readDialogueId(raw.id, `${path}.id`),
    mapId: readMapId(raw.mapId, `${path}.mapId`),
    npcName: readString(raw.npcName, `${path}.npcName`),
    position: readPoint(raw.position, `${path}.position`),
    text: readString(raw.text, `${path}.text`),
    media: readMedia(raw.media, `${path}.media`),
    spokenAt: readInstant(raw.spokenAt, `${path}.spokenAt`),
    relevance: readRelevance(raw.relevance, `${path}.relevance`, tagOrder),
    references: readArray(raw.references, `${path}.references`).map((ref, index) =>
      readDialogueId(ref, `${path}.references[${index}]`),
    ),
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
    relevance: readRelevance(raw.relevance, `${path}.relevance`, tagOrder),
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
 * The version is a guard, not a migration chain — see CLAUDE.md § "Schema versioning". One
 * reader for the current version, at most one migration step back; nothing older is read.
 */
function readProjectFile(value: unknown): { file: ProjectFile; repairs: ProjectRepairs } {
  const raw = readObject(value, 'data.json')
  const schemaVersion = readNumber(raw.schemaVersion, 'schemaVersion')
  if (schemaVersion !== 11) {
    throw new SchemaError('schemaVersion', `11, but found ${String(schemaVersion)}`)
  }
  const repaired = repairReferences(readCurrentProjectFile(raw))
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
/** Filters a list and reports how many elements it dropped, so every repair pass counts the same way. */
function filterCounting<T>(
  items: readonly T[],
  keep: (item: T) => boolean,
): { kept: T[]; dropped: number } {
  const kept = items.filter(keep)
  return { kept, dropped: items.length - kept.length }
}

function repairReferences(file: ProjectFile): { file: ProjectFile; repairs: ProjectRepairs } {
  const mapIds = new Set<MapId>(file.maps.map((map) => map.id))
  const { kept: survivingDialogues, dropped: droppedDialogues } = filterCounting(
    file.dialogues,
    (dialogue) => mapIds.has(dialogue.mapId),
  )
  const { kept: zones, dropped: droppedZones } = filterCounting(file.zones, (zone) =>
    mapIds.has(zone.mapId),
  )

  // Against the *surviving* dialogues, so a quest reference to a dialogue dropped one line
  // above goes with it — the two repairs are one pass, not two independent ones.
  const dialogueIds = new Set<DialogueId>(survivingDialogues.map((dialogue) => dialogue.id))
  let questDialogueIds = 0
  const quests = file.quests.map((quest) => {
    const { kept, dropped } = filterCounting(quest.dialogueIds, (id) => dialogueIds.has(id))
    if (dropped === 0) return quest
    questDialogueIds += dropped
    return { ...quest, dialogueIds: kept }
  })

  // Every id readRelevance read is already normalised into canonical order; only ids naming
  // no current tag need dropping, and readRelevance trails those after the known ones.
  const tagIds = new Set<RelevanceTagId>(file.relevanceTags.map((tag) => tag.id))
  let relevance = 0
  let dialogueReferences = 0
  const dialogues = survivingDialogues.map((dialogue) => {
    const keptRelevance = filterCounting(dialogue.relevance, (id) => tagIds.has(id))
    const keptReferences = filterCounting(
      dialogue.references,
      (id) => dialogueIds.has(id) && id !== dialogue.id,
    )
    if (keptRelevance.dropped === 0 && keptReferences.dropped === 0) return dialogue
    relevance += keptRelevance.dropped
    dialogueReferences += keptReferences.dropped
    return { ...dialogue, relevance: keptRelevance.kept, references: keptReferences.kept }
  })

  // A pending capture carries no `mapId`, so it has nothing to be orphaned from — only its
  // relevance ids can dangle, repaired the same way and folded into the same count.
  const pendingCaptures = file.pendingCaptures.map((capture) => {
    const { kept, dropped } = filterCounting(capture.relevance, (id) => tagIds.has(id))
    if (dropped === 0) return capture
    relevance += dropped
    return { ...capture, relevance: kept }
  })

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

function readCurrentProjectFile(raw: Record<string, unknown>): ProjectFile {
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
    projectName: readString(raw.projectName, 'projectName'),
    savedAt: readInstant(raw.savedAt, 'savedAt'),
    zones: readUniqueArray(raw, 'zones', readZone),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues,
    quests: readUniqueArray(raw, 'quests', readQuest),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfile),
    relevanceTags,
    glyphs: readGlyphs(raw.glyphs, 'glyphs'),
    pendingCaptures,
    recorderBindings: readRecorderBindings(raw.recorderBindings, 'recorderBindings'),
  }
}

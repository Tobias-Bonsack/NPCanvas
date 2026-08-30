import { defaultRelevanceTags } from '../dialogue/relevance.ts'
import { nextMapOrigin } from '../map/canvas-layout.ts'
import { nextQuestHue } from '../quest/quest-style.ts'
import {
  assertUniqueIds,
  readArray,
  readCaptureProfile,
  readCommonFields,
  readDialogueCommon,
  readDialogueId,
  readGameMap,
  readGlyphs,
  readMapId,
  readMedia,
  readMediaFile,
  readNonNegativeNumber,
  readNumber,
  readObject,
  readPendingCapture,
  readPixelRect,
  readPositiveNumber,
  readCaptureProfileId,
  readProjectFileV11,
  readQuestId,
  readQuestsV3,
  readQuestStatus,
  readRelevanceTag,
  readRelevanceV5,
  readRecorderBindings,
  readString,
  readUniqueArray,
  SchemaError,
} from './data-file.ts'
import { newMediaId } from './ids.ts'
import type {
  CaptureProfile,
  CaptureProfileV5,
  CaptureProfileV7,
  CaptureProfileV8,
  DialogueV3,
  DialogueV4,
  DialogueV10,
  GameMap,
  GameMapV1,
  Glyph,
  ProjectFile,
  ProjectFileV1,
  ProjectFileV2,
  ProjectFileV3,
  ProjectFileV4,
  ProjectFileV5,
  ProjectFileV6,
  ProjectFileV7,
  ProjectFileV8,
  ProjectFileV9,
  ProjectFileV10,
  ProjectFileV11,
  Quest,
  QuestV2,
  RelevanceSlugV4,
  RelevanceTagId,
} from './types.ts'
import { RELEVANCE_SLUGS_V4 } from './types.ts'

// ---- pre-migration readers ----
//
// Everything below is read only by a session adding a tenth migration: every reader here
// parses a shape no live code path writes anymore, and every `migrateVN` turns that shape into
// the next one. `data-file.ts` keeps the shared primitives and the current-version readers;
// this file is the ledger of every version this project's `data.json` has ever had.

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

/**
 * A V8 profile, carrying the gauge measurement V9 dropped. Kept beside `readCaptureProfileV5` as
 * the pre-migration reader, and the only thing that still builds `CaptureProfileV8`.
 */
function readCaptureProfileV8(value: unknown, path: string): CaptureProfileV8 {
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
 * pre-migration reader, and used by both `readCaptureProfile` and `readCaptureProfileV8` for the
 * fields they share — the measurement V8 added and V9 dropped again is appended *after* them, so a
 * migrated document's first save writes the keys in the order every save after it does.
 */
export function readCaptureProfileV7(value: unknown, path: string): CaptureProfileV7 {
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

export function readGameMapV1(value: unknown, path: string): GameMapV1 {
  const raw = readObject(value, path)
  return {
    id: readMapId(raw.id, `${path}.id`),
    name: readString(raw.name, `${path}.name`),
    file: readMediaFile(raw.file, `${path}.file`),
    width: readPositiveNumber(raw.width, `${path}.width`),
    height: readPositiveNumber(raw.height, `${path}.height`),
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

/**
 * Frozen V10 dialogue shape — no `references`, since nothing before V11 could write one. Used by
 * `readProjectFileV5` through `readProjectFileV10`; the live `readDialogue` in `data-file.ts` is
 * for V11 only.
 */
function readDialogueV10(
  value: unknown,
  path: string,
  tagOrder: readonly RelevanceTagId[],
): DialogueV10 {
  const raw = readObject(value, path)
  return {
    ...readDialogueCommon(raw, path, (v, p) => readRelevanceV5(v, p, tagOrder)),
    text: readString(raw.text, `${path}.text`),
    media: readMedia(raw.media, `${path}.media`),
  }
}

function readDialoguesV10(raw: Record<string, unknown>, tagOrder: readonly RelevanceTagId[]): DialogueV10[] {
  const dialogues = readArray(raw.dialogues, 'dialogues').map((item, index) =>
    readDialogueV10(item, `dialogues[${index}]`, tagOrder),
  )
  assertUniqueIds(dialogues, 'dialogues')
  return dialogues
}

function readDialogueV3(value: unknown, path: string): DialogueV3 {
  const raw = readObject(value, path)
  return {
    ...readDialogueCommon(raw, path, readRelevanceV4),
    content: readDialogueContentV3(raw.content, `${path}.content`),
  }
}

export function readQuestV2(value: unknown, path: string): QuestV2 {
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

// ---- routing ----

/**
 * Migrations chain one step at a time rather than jumping straight to the newest shape: a
 * fourth version then adds one `migrateV3` and one `case`, instead of a new N→newest function
 * per version already on disk.
 */
export function readVersionedProjectFile(raw: Record<string, unknown>): ProjectFile {
  const schemaVersion = readNumber(raw.schemaVersion, 'schemaVersion')
  switch (schemaVersion) {
    case 1:
      return migrateV10(
        migrateV9(
          migrateV8(
            migrateV7(
              migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(migrateV1(readProjectFileV1(raw))))))),
            ),
          ),
        ),
      )
    case 2:
      return migrateV10(
        migrateV9(
          migrateV8(
            migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(readProjectFileV2(raw))))))),
          ),
        ),
      )
    case 3:
      return migrateV10(
        migrateV9(
          migrateV8(migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(readProjectFileV3(raw))))))),
        ),
      )
    case 4:
      return migrateV10(migrateV9(migrateV8(migrateV7(migrateV6(migrateV5(migrateV4(readProjectFileV4(raw))))))))
    case 5:
      return migrateV10(migrateV9(migrateV8(migrateV7(migrateV6(migrateV5(readProjectFileV5(raw)))))))
    case 6:
      return migrateV10(migrateV9(migrateV8(migrateV7(migrateV6(readProjectFileV6(raw))))))
    case 7:
      return migrateV10(migrateV9(migrateV8(migrateV7(readProjectFileV7(raw)))))
    case 8:
      return migrateV10(migrateV9(migrateV8(readProjectFileV8(raw))))
    case 9:
      return migrateV10(migrateV9(readProjectFileV9(raw)))
    case 10:
      return migrateV10(readProjectFileV10(raw))
    case 11:
      return readProjectFileV11(raw)
    default:
      throw new SchemaError(
        'schemaVersion',
        `1, 2, 3, 4, 5, 6, 7, 8, 9, 10 or 11, but found ${String(schemaVersion)}`,
      )
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
  const dialogues = readDialoguesV10(raw, tagOrder)
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
  const dialogues = readDialoguesV10(raw, tagOrder)
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
  const dialogues = readDialoguesV10(raw, tagOrder)
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
  const dialogues = readDialoguesV10(raw, tagOrder)
  const pendingCaptures = readUniqueArray(raw, 'pendingCaptures', (item, path) =>
    readPendingCapture(item, path, tagOrder),
  )
  return {
    schemaVersion: 8,
    ...readCommonFields(raw),
    maps: readUniqueArray(raw, 'maps', readGameMap),
    dialogues,
    quests: readQuestsV3(raw),
    captureProfiles: readUniqueArray(raw, 'captureProfiles', readCaptureProfileV8),
    relevanceTags,
    glyphs: readGlyphs(raw.glyphs, 'glyphs'),
    pendingCaptures,
  }
}

/**
 * V9 reads the profile shape with `battleRect` gone again — #104 deleted the machinery that read
 * it, so a V9 document holds a plain `CaptureProfile`. Otherwise identical to V8.
 */
function readProjectFileV9(raw: Record<string, unknown>): ProjectFileV9 {
  const relevanceTags = readUniqueArray(raw, 'relevanceTags', readRelevanceTag)
  const tagOrder = relevanceTags.map((tag) => tag.id)
  const dialogues = readDialoguesV10(raw, tagOrder)
  const pendingCaptures = readUniqueArray(raw, 'pendingCaptures', (item, path) =>
    readPendingCapture(item, path, tagOrder),
  )
  return {
    schemaVersion: 9,
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

// ---- migrateVN ----

// V1 had no shared canvas: lay its maps out left to right via `nextMapOrigin`, same as an import.
function migrateV1(file: ProjectFileV1): ProjectFileV2 {
  const maps: GameMap[] = []
  for (const map of file.maps) {
    maps.push({ ...map, origin: nextMapOrigin(maps), scale: 1 })
  }
  return { ...file, schemaVersion: 2, maps }
}

// V2 drew every quest in one gold: hand out colours via `nextQuestHue`, same as creating a quest.
function migrateV2(file: ProjectFileV2): ProjectFileV3 {
  const quests: Quest[] = []
  for (const quest of file.quests) {
    quests.push({ ...quest, hue: nextQuestHue(quests) })
  }
  return { ...file, schemaVersion: 3, quests }
}

// V3 held text xor one file per dialogue; split into the V4 { text, media } pair, `fileName` kept as-is (a migration must not touch `media/`).
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

// V4 compiled relevance in; V5 moves it into the document via `defaultRelevanceTags`, rewriting each dialogue's slugs into the matching ids.
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

// V5 gave each profile its own alphabet; V6 folds them into one, keeping the first naming of a bitmap (not `mergeGlyphs`) since the earliest-taught profile is the fullest.
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

// V6 had no `PendingCapture`; V7 just adds the empty list, nothing to carry over.
function migrateV6(file: ProjectFileV6): ProjectFileV7 {
  return { ...file, schemaVersion: 7, pendingCaptures: [] }
}

// V8 adds `battleRect: null` — nothing to derive it from, and `null` means "not measured yet".
function migrateV7(file: ProjectFileV7): ProjectFileV8 {
  return {
    ...file,
    schemaVersion: 8,
    captureProfiles: file.captureProfiles.map((profile) => ({ ...profile, battleRect: null })),
  }
}

// V9 drops `battleRect` again: the battle-detection code that read it is gone, so nothing reads it anymore.
function migrateV8(file: ProjectFileV8): ProjectFileV9 {
  return {
    ...file,
    schemaVersion: 9,
    captureProfiles: file.captureProfiles.map(dropBattleRect),
  }
}

/** A V8 profile as V9 stores it. Written out field by field rather than destructured, because
 * `noUnusedLocals` fails on the binding a rest-spread would leave behind. */
function dropBattleRect(profile: CaptureProfileV8): CaptureProfile {
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

// V9 had no `RecorderBinding`; V10 just adds the empty list, same shape as `migrateV6`.
function migrateV9(file: ProjectFileV9): ProjectFileV10 {
  return { ...file, schemaVersion: 10, recorderBindings: [] }
}

/** Frozen V10 reader — used by the V10-to-V11 migration. */
function readProjectFileV10(raw: Record<string, unknown>): ProjectFileV10 {
  const relevanceTags = readUniqueArray(raw, 'relevanceTags', readRelevanceTag)
  const tagOrder = relevanceTags.map((tag) => tag.id)
  const dialogues = readDialoguesV10(raw, tagOrder)
  const pendingCaptures = readUniqueArray(raw, 'pendingCaptures', (item, path) =>
    readPendingCapture(item, path, tagOrder),
  )
  return {
    schemaVersion: 10,
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

function migrateV10(file: ProjectFileV10): ProjectFileV11 {
  return {
    ...file,
    schemaVersion: 11,
    dialogues: file.dialogues.map((dialogue) => ({
      id: dialogue.id,
      mapId: dialogue.mapId,
      npcName: dialogue.npcName,
      position: dialogue.position,
      text: dialogue.text,
      media: dialogue.media,
      spokenAt: dialogue.spokenAt,
      relevance: dialogue.relevance,
      references: [],
    })),
  }
}

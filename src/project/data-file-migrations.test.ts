import { describe, expect, it } from 'vitest'
import { MAP_LAYOUT_GAP } from '../map/canvas-layout.ts'
import { QUEST_HUES } from '../quest/quest-style.ts'
import { parseProjectFile, serializeProject } from './data-file.ts'
import {
  rejectionMessage,
  v1Document,
  v2Document,
  v3Document,
  v4Document,
  v7Document,
  v9Document,
  validDocument,
} from './data-file.test.ts'

describe('parseProjectFile: migration chain', () => {
  it('carries a V5 document through to V7 with its placements, hues and tags unchanged', () => {
    const result = parseProjectFile(JSON.stringify(validDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.maps[0].origin).toEqual({ x: -400, y: 250 })
    expect(result.file.maps[0].scale).toBe(0.75)
    expect(result.file.quests[0].hue).toBe(45)
    expect(result.file.pendingCaptures).toEqual([])
    expect(result.file.relevanceTags).toEqual([
      { id: 'out-of-world', name: 'Out of world', hue: 220 },
      { id: 'worldbuilding', name: 'Worldbuilding', hue: 150 },
      { id: 'peoplebuilding', name: 'Peoplebuilding', hue: 35 },
      { id: 'other', name: 'Other', hue: 290 },
    ])

    const rewritten = parseProjectFile(serializeProject(result.file))
    expect(rewritten.ok).toBe(true)
    if (!rewritten.ok) return
    expect(rewritten.file.maps).toEqual(result.file.maps)
    expect(rewritten.file.quests).toEqual(result.file.quests)
    expect(rewritten.file.dialogues).toEqual(result.file.dialogues)
    expect(rewritten.file.relevanceTags).toEqual(result.file.relevanceTags)
  })
})

describe('parseProjectFile: V5 migration', () => {
  it('folds every profile’s alphabet into one the project owns', () => {
    const result = parseProjectFile(JSON.stringify(twoProfileDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.glyphs).toEqual([
      { char: 'P', bits: 'fc8282fc80808000' },
      { char: 'a', bits: '000038043c443e00' },
      { char: '', bits: '00fefe7c38100000' },
      { char: 'z', bits: '00007e0c18307e00' },
    ])
  })

  it('keeps the first profile’s naming when two profiles read one bitmap differently', () => {
    const result = parseProjectFile(JSON.stringify(twoProfileDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.glyphs.filter((glyph) => glyph.bits === 'fc8282fc80808000')).toEqual([
      { char: 'P', bits: 'fc8282fc80808000' },
    ])
  })

  it('leaves the profiles themselves as measurements, with no alphabet of their own', () => {
    const result = parseProjectFile(JSON.stringify(twoProfileDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.captureProfiles.map((profile) => profile.name)).toEqual([
      'Yellow',
      'Pokedex',
    ])
    for (const profile of result.file.captureProfiles) {
      expect(profile).not.toHaveProperty('glyphs')
    }
    expect(result.file.captureProfiles[1].textRect).toEqual({ x: 8, y: 88, width: 144, height: 40 })
  })

  it('gives a project with no profiles at all an empty alphabet rather than none', () => {
    const result = parseProjectFile(JSON.stringify(validDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.glyphs).toEqual([])
  })

  it('round trips a migrated document, alphabet included', () => {
    const migrated = parseProjectFile(JSON.stringify(twoProfileDocument()))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return

    const reread = parseProjectFile(serializeProject(migrated.file))
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.file.schemaVersion).toBe(10)
    expect({ ...reread.file, savedAt: '' }).toEqual({ ...migrated.file, savedAt: '' })
  })

  it('writes a migrated two-profile project identically the second time', () => {
    const first = parseProjectFile(JSON.stringify(twoProfileDocument()))
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const once = serializeProject(first.file)
    const reread = parseProjectFile(once)
    expect(reread.ok).toBe(true)
    if (!reread.ok) return

    const withoutSavedAt = (text: string): string =>
      text.replace(/"savedAt": "[^"]*"/g, '"savedAt": "<stamped>"')
    expect(withoutSavedAt(serializeProject(reread.file))).toBe(withoutSavedAt(once))
  })

  it('rejects an alphabet that is not an array', () => {
    const data = validDocument()
    data.schemaVersion = 6
    data.glyphs = { P: 'fc8282fc80808000' }
    expect(rejectionMessage(data)).toBe('glyphs: expected an array')
  })

  it('rejects a glyph that is not a record of a character and a bitmap', () => {
    const data = validDocument()
    data.schemaVersion = 6
    data.glyphs = [{ char: 'P' }]
    expect(rejectionMessage(data)).toBe('glyphs[0].bits: expected a string')
  })
})

/** A V5 document with two profiles whose alphabets overlap — and disagree once. */
function twoProfileDocument(): Record<string, unknown> {
  const data = validDocument()
  data.captureProfiles = [
    {
      id: 'profile-1',
      name: 'Yellow',
      frameWidth: 3840,
      frameHeight: 2088,
      screenRect: { x: 814, y: 64, width: 2211, height: 1991 },
      nativeWidth: 160,
      nativeHeight: 144,
      textRect: { x: 8, y: 104, width: 144, height: 32 },
      glyphs: [
        { char: 'P', bits: 'fc8282fc80808000' },
        { char: 'a', bits: '000038043c443e00' },
        // The blinking continuation arrow: recognised, and dropped from every transcript.
        { char: '', bits: '00fefe7c38100000' },
      ],
    },
    {
      id: 'profile-2',
      name: 'Pokedex',
      frameWidth: 3840,
      frameHeight: 2088,
      screenRect: { x: 814, y: 64, width: 2211, height: 1989 },
      nativeWidth: 160,
      nativeHeight: 144,
      textRect: { x: 8, y: 88, width: 144, height: 40 },
      glyphs: [
        { char: 'p', bits: 'fc8282fc80808000' },
        { char: 'a', bits: '000038043c443e00' },
        { char: 'z', bits: '00007e0c18307e00' },
      ],
    },
  ]
  return data
}

/** A V6 document: today's shape minus `pendingCaptures`, which V7 adds. */
function v6Document(): Record<string, unknown> {
  const data = validDocument()
  data.schemaVersion = 6
  data.glyphs = []
  return data
}

describe('parseProjectFile: V9 migration', () => {
  it('adds an empty recorderBindings list, since nothing before V10 could have written one', () => {
    const result = parseProjectFile(JSON.stringify(v9Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.recorderBindings).toEqual([])
    expect(result.file.captureProfiles).toHaveLength(1)
    expect(result.file.captureProfiles[0]).not.toHaveProperty('battleRect')
  })
})

describe('parseProjectFile: V7 migration', () => {
  it('carries a profile with no gauge measurement through to the current schema unchanged', () => {
    const result = parseProjectFile(JSON.stringify(v7Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.captureProfiles).toHaveLength(1)
    expect(result.file.captureProfiles[0]).not.toHaveProperty('battleRect')
    // Every other measurement is the one that was on disk.
    expect(result.file.captureProfiles[0].textRect).toEqual({ x: 8, y: 104, width: 144, height: 32 })
  })
})

/** A V8 document whose one profile already carries a measured gauge. */
function v8Document(): Record<string, unknown> {
  const data = v7Document()
  data.schemaVersion = 8
  const profiles = data.captureProfiles as Record<string, unknown>[]
  profiles[0].battleRect = { x: 30, y: 16, width: 56, height: 8 }
  return data
}

describe('parseProjectFile: V8 migration', () => {
  it('drops the gauge measurement nothing has read since #104, keeping every other measurement', () => {
    const result = parseProjectFile(JSON.stringify(v8Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.captureProfiles).toHaveLength(1)
    expect(result.file.captureProfiles[0]).not.toHaveProperty('battleRect')
    expect(result.file.captureProfiles[0].textRect).toEqual({ x: 8, y: 104, width: 144, height: 32 })
  })
})

describe('parseProjectFile: V6 migration', () => {
  it('adds an empty pendingCaptures list, since nothing before V7 could have written one', () => {
    const result = parseProjectFile(JSON.stringify(v6Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.pendingCaptures).toEqual([])
    expect(result.file.maps[0].origin).toEqual({ x: -400, y: 250 })
    expect(result.file.dialogues).toHaveLength(4)
  })
})

describe('parseProjectFile: V4 migration', () => {
  it('moves the compiled-in vocabulary into the document, seeding the same tags a fresh project gets', () => {
    const result = parseProjectFile(JSON.stringify(v4Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.relevanceTags.map((tag) => tag.name)).toEqual([
      'Out of world',
      'Worldbuilding',
      'Peoplebuilding',
      'Other',
    ])
    expect(result.file.relevanceTags.map((tag) => tag.hue)).toEqual([220, 150, 35, 290])
    expect(new Set(result.file.relevanceTags.map((tag) => tag.id)).size).toBe(4)
  })

  it('rewrites every dialogue’s relevance from the old slugs to the freshly minted tag ids', () => {
    const result = parseProjectFile(JSON.stringify(v4Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [outOfWorld, worldbuilding, peoplebuilding, other] = result.file.relevanceTags
    expect(result.file.dialogues[0].relevance).toEqual([worldbuilding.id])
    expect(result.file.dialogues[1].relevance).toEqual([])
    expect(result.file.dialogues[2].relevance).toEqual([outOfWorld.id, other.id])
    expect(result.file.dialogues[3].relevance).toEqual([peoplebuilding.id])
  })

  it('leaves everything a V4 document already got right alone', () => {
    const result = parseProjectFile(JSON.stringify(v4Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.maps[0].origin).toEqual({ x: -400, y: 250 })
    expect(result.file.quests[0].hue).toBe(45)
    expect(result.file.zones[0].name).toBe('Harbour')
  })
})

describe('parseProjectFile: V3 migration', () => {
  it('splits every old content kind into a line and its pictures', () => {
    const result = parseProjectFile(JSON.stringify(v3Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.captureProfiles).toEqual([])

    const [text, image, gif, video] = result.file.dialogues
    expect(text).toMatchObject({ text: 'The tide took it.', media: [] })

    expect(image.text).toBe('')
    expect(image.media).toHaveLength(1)
    expect(image.media[0]).toMatchObject({ kind: 'image', width: 800, height: 600 })

    expect(gif.media[0]).toMatchObject({ kind: 'gif', width: 320, height: 240 })
    expect(video.media[0]).toMatchObject({ kind: 'video', durationMs: 4200 })
  })

  it('carries every fileName over verbatim, because a migration cannot rename a file', () => {
    const result = parseProjectFile(JSON.stringify(v3Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.dialogues.flatMap((dialogue) => dialogue.media.map((m) => m.file))).toEqual([
      { fileName: 'dialogue-2.png', mimeType: 'image/png', byteSize: 1024 },
      { fileName: 'dialogue-3.gif', mimeType: 'image/gif', byteSize: 2048 },
      { fileName: 'dialogue-4.webm', mimeType: 'video/webm', byteSize: 65536 },
    ])
  })

  it('gives every migrated medium its own id', () => {
    const result = parseProjectFile(JSON.stringify(v3Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ids = result.file.dialogues.flatMap((dialogue) => dialogue.media.map((m) => m.id))
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
  })

  it('leaves everything a V3 document already got right alone', () => {
    const result = parseProjectFile(JSON.stringify(v3Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.maps[0].origin).toEqual({ x: -400, y: 250 })
    expect(result.file.quests[0].hue).toBe(45)
    expect(result.file.zones[0].name).toBe('Harbour')
  })
})

describe('parseProjectFile: V2 migration', () => {
  it('colours every quest distinctly, in palette order, and changes nothing else', () => {
    const before = v2Document()
    const result = parseProjectFile(JSON.stringify(before))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.quests.map((quest) => quest.hue)).toEqual([
      QUEST_HUES[0],
      QUEST_HUES[1],
      QUEST_HUES[2],
    ])
    expect(result.file.quests.map((quest) => ({ ...quest, hue: undefined }))).toEqual( // rest untouched
      (before.quests as Record<string, unknown>[]).map((quest) => ({ ...quest, hue: undefined })),
    )
    expect(result.file.maps[0].origin).toEqual({ x: -400, y: 250 })
    expect(result.file.dialogues).toHaveLength(4)
    expect(result.file.zones[0].name).toBe('Harbour')
  })

  it('rejects a V2 quest whose fields are still wrong', () => {
    const data = v2Document()
    const quests = data.quests as Record<string, unknown>[]
    quests[1].status = 'abandoned'
    expect(rejectionMessage(data)).toBe('quests[1].status: expected open or done')
  })
})

describe('parseProjectFile: V1 migration', () => {
  it('chains V1 all the way through to V7, placing the maps and colouring the quests', () => {
    const result = parseProjectFile(JSON.stringify(v1Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(10)
    expect(result.file.dialogues).toHaveLength(4)
    expect(result.file.dialogues[0]).toMatchObject({ text: 'The tide took it.', media: [] })
    expect(result.file.dialogues[3].media[0]).toMatchObject({ kind: 'video', durationMs: 4200 })
    expect(result.file.captureProfiles).toEqual([])
    expect(result.file.relevanceTags).toHaveLength(4)
    expect(result.file.glyphs).toEqual([])
    expect(result.file.pendingCaptures).toEqual([])
    expect(result.file.zones[0].name).toBe('Harbour')
    expect(result.file.quests[0].dialogueIds).toEqual(['dialogue-1', 'dialogue-4'])
    expect(result.file.quests.map((quest) => quest.hue)).toEqual([
      QUEST_HUES[0],
      QUEST_HUES[1],
      QUEST_HUES[2],
    ])
  })

  it('lays the V1 maps out left to right at native scale, with nothing overlapping', () => {
    const result = parseProjectFile(JSON.stringify(v1Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.maps.map((map) => map.scale)).toEqual([1, 1, 1])
    expect(result.file.maps.map((map) => map.origin)).toEqual([
      { x: 0, y: 0 },
      { x: 2000 + MAP_LAYOUT_GAP, y: 0 },
      { x: 2000 + MAP_LAYOUT_GAP + 800 + MAP_LAYOUT_GAP, y: 0 },
    ])
  })

  it('accepts a V1 document with no maps at all', () => {
    const data = v1Document()
    data.maps = []
    data.zones = []
    data.dialogues = []
    data.quests = []

    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file).toMatchObject({ schemaVersion: 10, maps: [], pendingCaptures: [] })
  })

  it('still validates the V1 fields it reads', () => {
    const data = v1Document()
    const maps = data.maps as Record<string, unknown>[]
    maps[1].width = '800'
    expect(rejectionMessage(data)).toBe('maps[1].width: expected a finite number')
  })
})

describe('serializeProject: a migrated document is byte-stable on its second save', () => {
  it('writes a migrated V1 project identically the second time', () => {
    const migrated = parseProjectFile(JSON.stringify(v1Document()))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return

    const firstSave = serializeProject(migrated.file)
    const reread = parseProjectFile(firstSave)
    expect(reread.ok).toBe(true)
    if (!reread.ok) return

    // savedAt is restamped on every write, the one field allowed to differ here.
    const withoutSavedAt = (text: string): string =>
      text.replace(/"savedAt": "[^"]*"/g, '"savedAt": "<stamped>"')
    expect(withoutSavedAt(serializeProject(reread.file))).toBe(withoutSavedAt(firstSave))
    expect(reread.file.schemaVersion).toBe(10)
  })
})

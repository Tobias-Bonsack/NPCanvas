import { describe, expect, it } from 'vitest'
import { MAP_LAYOUT_GAP, MAX_MAP_SCALE, MIN_MAP_SCALE } from '../map/canvas-layout.ts'
import { QUEST_HUES } from '../quest/quest-style.ts'
import type { ParseResult } from './data-file.ts'
import { createEmptyProject, parseProjectFile, serializeProject } from './data-file.ts'

// A document exercising every branch of the reader: a line with no pictures, all three media
// kinds, a polygon, a quest and the four relevance tags. Rebuilt per test so a mutation cannot
// leak into the next case. Tag ids deliberately match the old V4 slugs, which is what lets
// `v4Document` below reuse these dialogues' `relevance` arrays verbatim.
function validDocument(): Record<string, unknown> {
  return {
    schemaVersion: 5,
    projectName: 'Fisherman’s Rest',
    savedAt: '2026-08-14T10:00:00.000Z',
    maps: [
      {
        id: 'map-1',
        name: 'Overworld',
        file: { fileName: 'map-1.png', mimeType: 'image/png', byteSize: 204800 },
        width: 2000,
        height: 1500,
        origin: { x: -400, y: 250 },
        scale: 0.75,
      },
    ],
    zones: [
      {
        id: 'zone-1',
        mapId: 'map-1',
        name: 'Harbour',
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 80 },
          { x: 0, y: 80 },
        ],
        hue: 200,
      },
    ],
    dialogues: [
      {
        id: 'dialogue-1',
        mapId: 'map-1',
        npcName: 'Old Fisher',
        position: { x: 40, y: 30 },
        text: 'The tide took it.',
        media: [],
        spokenAt: '2026-08-14T09:12:00.000Z',
        relevance: ['worldbuilding'],
      },
      {
        id: 'dialogue-2',
        mapId: 'map-1',
        npcName: 'Dockhand',
        position: { x: 55, y: 12 },
        text: 'Two crates, no more.',
        media: [
          {
            id: 'media-2a',
            kind: 'image',
            file: { fileName: 'dialogue-2-media-2a.png', mimeType: 'image/png', byteSize: 1024 },
            width: 800,
            height: 600,
          },
          {
            id: 'media-2b',
            kind: 'image',
            file: { fileName: 'dialogue-2-media-2b.png', mimeType: 'image/png', byteSize: 2048 },
            width: 800,
            height: 600,
          },
        ],
        spokenAt: '2026-08-14T09:20:00.000Z',
        relevance: [],
      },
      {
        id: 'dialogue-3',
        mapId: 'map-1',
        npcName: 'Gull',
        position: { x: 5, y: 5 },
        text: '',
        media: [
          {
            id: 'media-3',
            kind: 'gif',
            file: { fileName: 'dialogue-3-media-3.gif', mimeType: 'image/gif', byteSize: 2048 },
            width: 320,
            height: 240,
          },
        ],
        spokenAt: '2026-08-14T09:30:00.000Z',
        relevance: ['out-of-world', 'other'],
      },
      {
        id: 'dialogue-4',
        mapId: 'map-1',
        npcName: 'Harbourmaster',
        position: { x: 90, y: 70 },
        text: '',
        media: [
          {
            id: 'media-4',
            kind: 'video',
            file: { fileName: 'dialogue-4-media-4.webm', mimeType: 'video/webm', byteSize: 65536 },
            width: 640,
            height: 360,
            durationMs: 4200,
          },
        ],
        spokenAt: '2026-08-14T09:40:00.000Z',
        relevance: ['peoplebuilding'],
      },
    ],
    quests: [
      {
        id: 'quest-1',
        name: 'Recover the net',
        status: 'open',
        dialogueIds: ['dialogue-1', 'dialogue-4'],
        note: 'Ask at the harbour first.',
        hue: 45,
      },
    ],
    captureProfiles: [],
    relevanceTags: [
      { id: 'out-of-world', name: 'Out of world', hue: 220 },
      { id: 'worldbuilding', name: 'Worldbuilding', hue: 150 },
      { id: 'peoplebuilding', name: 'Peoplebuilding', hue: 35 },
      { id: 'other', name: 'Other', hue: 290 },
    ],
  }
}

/** Fails the test if the document parses, so every rejection case asserts on a real message. */
function rejectionMessage(data: unknown): string {
  const result = parseProjectFile(JSON.stringify(data))
  if (result.ok) throw new Error('expected the document to be rejected, but it parsed')
  return result.message
}

describe('parseProjectFile', () => {
  it('accepts a valid document and round trips through serializeProject', () => {
    const result = parseProjectFile(JSON.stringify(validDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.projectName).toBe('Fisherman’s Rest')
    expect(result.file.maps).toHaveLength(1)
    expect(result.file.zones[0].polygon).toHaveLength(4)
    expect(
      result.file.dialogues.map((dialogue) => dialogue.media.map((medium) => medium.kind)),
    ).toEqual([[], ['image', 'image'], ['gif'], ['video']])
    expect(result.file.dialogues[1].text).toBe('Two crates, no more.')
    expect(result.file.quests[0].dialogueIds).toEqual(['dialogue-1', 'dialogue-4'])

    const roundTripped = parseProjectFile(serializeProject(result.file))
    expect(roundTripped.ok).toBe(true)
    if (!roundTripped.ok) return
    // Everything but `savedAt` survives; `savedAt` is restamped on every write by design.
    expect({ ...roundTripped.file, savedAt: '' }).toEqual({ ...result.file, savedAt: '' })
  })

  it('tolerates unknown extra keys and drops them on the next write', () => {
    const data = validDocument()
    data.unknownTopLevel = { anything: true }
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].unknownDialogueKey = 'ignored'

    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file).not.toHaveProperty('unknownTopLevel')
    expect(result.file.dialogues[0]).not.toHaveProperty('unknownDialogueKey')
    expect(serializeProject(result.file)).not.toContain('unknownDialogueKey')
  })

  it('normalises relevance into the project’s own tag order, without duplicates', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].relevance = ['other', 'worldbuilding', 'worldbuilding']

    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.dialogues[0].relevance).toEqual(['worldbuilding', 'other'])
  })

  it('rejects invalid JSON', () => {
    const result = parseProjectFile('{ "schemaVersion": 1, ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('not valid JSON')
  })

  it('rejects an unknown schemaVersion', () => {
    const data = validDocument()
    data.schemaVersion = 6
    expect(rejectionMessage(data)).toBe('schemaVersion: expected 1, 2, 3, 4 or 5, but found 6')
  })

  it('rejects a map with no placement', () => {
    const data = validDocument()
    const maps = data.maps as Record<string, unknown>[]
    delete maps[0].origin
    expect(rejectionMessage(data)).toBe('maps[0].origin: expected an object')
  })

  it('round trips a V5 document with its placements, quest hues and relevance tags unchanged', () => {
    const result = parseProjectFile(JSON.stringify(validDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(5)
    expect(result.file.maps[0].origin).toEqual({ x: -400, y: 250 })
    expect(result.file.maps[0].scale).toBe(0.75)
    expect(result.file.quests[0].hue).toBe(45)
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

/** A V4 document: today's `Dialogue`, before relevance became a document-owned tag. */
function v4Document(): Record<string, unknown> {
  const data = validDocument()
  data.schemaVersion = 4
  delete data.relevanceTags
  return data
}

/**
 * A V3 document: one exclusive content slot per dialogue, and no capture profiles. All four old
 * kinds, because the V3→V4 migration has a branch per kind.
 */
function v3Document(): Record<string, unknown> {
  const data = v4Document()
  data.schemaVersion = 3
  delete data.captureProfiles
  data.dialogues = [
    {
      id: 'dialogue-1',
      mapId: 'map-1',
      npcName: 'Old Fisher',
      position: { x: 40, y: 30 },
      content: { kind: 'text', text: 'The tide took it.' },
      spokenAt: '2026-08-14T09:12:00.000Z',
      relevance: ['worldbuilding'],
    },
    {
      id: 'dialogue-2',
      mapId: 'map-1',
      npcName: 'Dockhand',
      position: { x: 55, y: 12 },
      content: {
        kind: 'image',
        file: { fileName: 'dialogue-2.png', mimeType: 'image/png', byteSize: 1024 },
        width: 800,
        height: 600,
      },
      spokenAt: '2026-08-14T09:20:00.000Z',
      relevance: [],
    },
    {
      id: 'dialogue-3',
      mapId: 'map-1',
      npcName: 'Gull',
      position: { x: 5, y: 5 },
      content: {
        kind: 'gif',
        file: { fileName: 'dialogue-3.gif', mimeType: 'image/gif', byteSize: 2048 },
        width: 320,
        height: 240,
      },
      spokenAt: '2026-08-14T09:30:00.000Z',
      relevance: ['out-of-world', 'other'],
    },
    {
      id: 'dialogue-4',
      mapId: 'map-1',
      npcName: 'Harbourmaster',
      position: { x: 90, y: 70 },
      content: {
        kind: 'video',
        file: { fileName: 'dialogue-4.webm', mimeType: 'video/webm', byteSize: 65536 },
        width: 640,
        height: 360,
        durationMs: 4200,
      },
      spokenAt: '2026-08-14T09:40:00.000Z',
      relevance: ['peoplebuilding'],
    },
  ]
  return data
}

/** A V2 document is a V3 one with the quest hues removed and the version rolled back. */
function v2Document(): Record<string, unknown> {
  const data = v3Document()
  data.schemaVersion = 2
  const [quest] = data.quests as Record<string, unknown>[]
  delete quest.hue
  data.quests = [
    quest,
    { ...quest, id: 'quest-2', name: 'Find the lantern', status: 'done', dialogueIds: [] },
    { ...quest, id: 'quest-3', name: 'Pay the ferryman', dialogueIds: [] },
  ]
  return data
}

/** A V1 document is a V2 one with the placement fields removed and the version rolled back. */
function v1Document(): Record<string, unknown> {
  const data = v2Document()
  data.schemaVersion = 1
  const [map] = data.maps as Record<string, unknown>[]
  delete map.origin
  delete map.scale
  data.maps = [
    map,
    {
      ...map,
      id: 'map-2',
      name: 'Caves',
      width: 800,
      height: 600,
      file: { fileName: 'map-2.png', mimeType: 'image/png', byteSize: 51200 },
    },
    {
      ...map,
      id: 'map-3',
      name: 'Keep',
      width: 1200,
      height: 400,
      file: { fileName: 'map-3.png', mimeType: 'image/png', byteSize: 76800 },
    },
  ]
  return data
}

describe('parseProjectFile: V4 migration', () => {
  it('moves the compiled-in vocabulary into the document, seeding the same tags a fresh project gets', () => {
    const result = parseProjectFile(JSON.stringify(v4Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(5)
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

    expect(result.file.schemaVersion).toBe(5)
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

    expect(result.file.schemaVersion).toBe(5)
    expect(result.file.quests.map((quest) => quest.hue)).toEqual([
      QUEST_HUES[0],
      QUEST_HUES[1],
      QUEST_HUES[2],
    ])
    // Everything but the added hue survives the migration untouched.
    expect(result.file.quests.map((quest) => ({ ...quest, hue: undefined }))).toEqual(
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
  it('chains V1 through V2, V3 and V4 to V5, placing the maps and colouring the quests', () => {
    const result = parseProjectFile(JSON.stringify(v1Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(5)
    expect(result.file.dialogues).toHaveLength(4)
    expect(result.file.dialogues[0]).toMatchObject({ text: 'The tide took it.', media: [] })
    expect(result.file.dialogues[3].media[0]).toMatchObject({ kind: 'video', durationMs: 4200 })
    expect(result.file.captureProfiles).toEqual([])
    expect(result.file.relevanceTags).toHaveLength(4)
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
    expect(result.file).toMatchObject({ schemaVersion: 5, maps: [] })
  })

  it('still validates the V1 fields it reads', () => {
    const data = v1Document()
    const maps = data.maps as Record<string, unknown>[]
    maps[1].width = '800'
    expect(rejectionMessage(data)).toBe('maps[1].width: expected a finite number')
  })
})

describe('parseProjectFile: field validation', () => {
  it('rejects a missing field', () => {
    const data = validDocument()
    delete data.projectName
    expect(rejectionMessage(data)).toBe('projectName: expected a string')
  })

  it('rejects a mistyped field', () => {
    const data = validDocument()
    const maps = data.maps as Record<string, unknown>[]
    maps[0].width = '2000'
    expect(rejectionMessage(data)).toBe('maps[0].width: expected a finite number')
  })

  it('rejects a polygon with fewer than three points', () => {
    const data = validDocument()
    const zones = data.zones as Record<string, unknown>[]
    zones[0].polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]
    expect(rejectionMessage(data)).toBe('zones[0].polygon: expected at least 3 points')
  })

  it('rejects an unknown dialogue media kind', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[2].media = [{ id: 'media-3', kind: 'audio', file: {}, width: 1, height: 1 }]
    expect(rejectionMessage(data)).toBe(
      'dialogues[2].media[0].kind: expected one of image, gif, video',
    )
  })

  it('rejects a medium with no id, so nothing can address it later', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    const media = dialogues[2].media as Record<string, unknown>[]
    delete media[0].id
    expect(rejectionMessage(data)).toBe('dialogues[2].media[0].id: expected a string')
  })

  it('rejects an unknown V3 content kind', () => {
    const data = v3Document()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[2].content = { kind: 'audio', file: {}, width: 1, height: 1 }
    expect(rejectionMessage(data)).toContain('dialogues[2].content.kind')
  })

  it('rejects an unknown V4 relevance slug', () => {
    const data = v4Document()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].relevance = ['worldbuilding', 'lore']
    expect(rejectionMessage(data)).toContain('dialogues[0].relevance[1]')
  })

  it('rejects a quest status outside open and done', () => {
    const data = validDocument()
    const quests = data.quests as Record<string, unknown>[]
    quests[0].status = 'abandoned'
    expect(rejectionMessage(data)).toBe('quests[0].status: expected open or done')
  })

  it('rejects a capture profile whose rect is not a rect', () => {
    const data = validDocument()
    data.captureProfiles = [
      {
        id: 'profile-1',
        name: 'Game Boy',
        frameWidth: 1998,
        frameHeight: 1123,
        screenRect: { x: 0, y: 0, width: 1148 },
        nativeWidth: 160,
        nativeHeight: 144,
        textRect: { x: 8, y: 96, width: 144, height: 40 },
        glyphs: [],
      },
    ]
    expect(rejectionMessage(data)).toBe(
      'captureProfiles[0].screenRect.height: expected a finite number',
    )
  })

  it('rejects a relevance tag hue outside 0..359', () => {
    const data = validDocument()
    const relevanceTags = data.relevanceTags as Record<string, unknown>[]
    relevanceTags[0].hue = 400
    expect(rejectionMessage(data)).toBe('relevanceTags[0].hue: expected a hue in 0..359')
  })

  it('rejects a relevance tag with no name', () => {
    const data = validDocument()
    const relevanceTags = data.relevanceTags as Record<string, unknown>[]
    delete relevanceTags[0].name
    expect(rejectionMessage(data)).toBe('relevanceTags[0].name: expected a string')
  })
})

describe('createEmptyProject', () => {
  it('writes the current schema version, so a new project is never migrated on its first read', () => {
    const project = createEmptyProject('Harbour')
    expect(project.schemaVersion).toBe(5)
    expect(project.captureProfiles).toEqual([])
    expect(project.relevanceTags.map((tag) => tag.name)).toEqual([
      'Out of world',
      'Worldbuilding',
      'Peoplebuilding',
      'Other',
    ])

    const reread = parseProjectFile(serializeProject(project))
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.file.schemaVersion).toBe(5)
  })
})

describe('serializeProject', () => {
  it('stamps a fresh savedAt and indents with two spaces', () => {
    const parsed = parseProjectFile(JSON.stringify(validDocument()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const before = new Date().toISOString()
    const text = serializeProject(parsed.file)

    expect(text).toContain('\n  "projectName"')
    const written = parseProjectFile(text)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(written.file.savedAt).not.toBe(parsed.file.savedAt)
    // ISO 8601 sorts chronologically, so string comparison is a real time comparison.
    expect(written.file.savedAt >= before).toBe(true)
  })
})

describe('parseProjectFile: values the app would then choke on', () => {
  it('rejects a savedAt no browser can read, rather than throwing during render', () => {
    const data = validDocument()
    data.savedAt = 'yesterday'
    expect(rejectionMessage(data)).toBe(
      'savedAt: expected a date the browser can read, such as 2026-08-14T10:00:00.000Z',
    )
  })

  it('rejects an unreadable spokenAt', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[1].spokenAt = '2026-13-45T99:99:99Z'
    expect(rejectionMessage(data)).toBe(
      'dialogues[1].spokenAt: expected a date the browser can read, such as 2026-08-14T10:00:00.000Z',
    )
  })

  it('accepts any instant Date can read, not only the exact toISOString shape', () => {
    const data = validDocument()
    data.savedAt = '2026-08-14T12:00:00+02:00'
    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
  })

  it.each([
    ['zero', 0, MIN_MAP_SCALE],
    ['negative', -3, MIN_MAP_SCALE],
    ['absurd', 5000, MAX_MAP_SCALE],
  ])('clamps a %s map scale the way the reducer would', (_label, scale, expected) => {
    const data = validDocument()
    const maps = data.maps as Record<string, unknown>[]
    maps[0].scale = scale

    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.maps[0].scale).toBe(expected)
  })

  it.each([
    ['maps[0].width', (data: Record<string, unknown>) => {
      ;(data.maps as Record<string, unknown>[])[0].width = -2000
    }],
    ['maps[0].height', (data: Record<string, unknown>) => {
      ;(data.maps as Record<string, unknown>[])[0].height = 0
    }],
    ['maps[0].file.byteSize', (data: Record<string, unknown>) => {
      const [map] = data.maps as Record<string, unknown>[]
      ;(map.file as Record<string, unknown>).byteSize = -1
    }],
    ['dialogues[1].media[0].width', (data: Record<string, unknown>) => {
      const dialogues = data.dialogues as Record<string, unknown>[]
      const media = dialogues[1].media as Record<string, unknown>[]
      media[0].width = 0
    }],
  ])('rejects %s when it is zero or negative', (path, corrupt) => {
    const data = validDocument()
    corrupt(data)
    expect(rejectionMessage(data)).toBe(`${path}: expected a number greater than 0`)
  })

  it('rejects a negative durationMs', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    const media = dialogues[3].media as Record<string, unknown>[]
    media[0].durationMs = -1
    expect(rejectionMessage(data)).toBe(
      'dialogues[3].media[0].durationMs: expected a number of 0 or more',
    )
  })

  it('accepts durationMs 0, which import-media writes for a clip of unknown length', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    const media = dialogues[3].media as Record<string, unknown>[]
    media[0].durationMs = 0

    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [medium] = result.file.dialogues[3].media
    expect(medium.kind === 'video' && medium.durationMs).toBe(0)
  })

  it('rejects two media in one dialogue sharing an id, which a remove would take both of', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    const media = dialogues[1].media as Record<string, unknown>[]
    media[1] = { ...media[1], id: media[0].id }
    expect(rejectionMessage(data)).toBe(
      'dialogues[1].media[1].id: expected an id not already used, but "media-2a" is',
    )
  })

  it('rejects a zone hue outside 0..359', () => {
    const data = validDocument()
    const zones = data.zones as Record<string, unknown>[]
    zones[0].hue = 400
    expect(rejectionMessage(data)).toBe('zones[0].hue: expected a hue in 0..359')
  })

  it('rejects a quest hue outside 0..359', () => {
    const data = validDocument()
    const quests = data.quests as Record<string, unknown>[]
    quests[0].hue = -1
    expect(rejectionMessage(data)).toBe('quests[0].hue: expected a hue in 0..359')
  })
})

describe('parseProjectFile: identity', () => {
  it.each([
    ['maps', 'map-1'],
    ['zones', 'zone-1'],
    ['dialogues', 'dialogue-1'],
    ['quests', 'quest-1'],
    ['relevanceTags', 'out-of-world'],
  ])('rejects two %s sharing an id, naming the id', (key, id) => {
    const data = validDocument()
    const records = data[key] as Record<string, unknown>[]
    // The duplicate is appended, so the message points at the copy rather than the original.
    data[key] = [...records, { ...records[0] }]
    expect(rejectionMessage(data)).toBe(
      `${key}[${String(records.length)}].id: expected an id not already used, but "${id}" is`,
    )
  })

  it('rejects two dialogues naming the same media file, because deleting one would take both', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    const media = dialogues[2].media as Record<string, unknown>[]
    media[0] = {
      ...media[0],
      file: { fileName: 'dialogue-2-media-2a.png', mimeType: 'image/png', byteSize: 1024 },
    }
    expect(rejectionMessage(data)).toBe(
      'dialogues[2].media[0].file.fileName: expected a file no other record names, ' +
        'but "dialogue-2-media-2a.png" is taken',
    )
  })

  it('rejects two maps sharing an image, which a map deletion would orphan for both', () => {
    const data = validDocument()
    const maps = data.maps as Record<string, unknown>[]
    data.maps = [...maps, { ...maps[0], id: 'map-2', name: 'Caves' }]
    expect(rejectionMessage(data)).toBe(
      'maps[1].file.fileName: expected a file no other record names, but "map-1.png" is taken',
    )
  })
})

describe('parseProjectFile: documents that are not documents', () => {
  it.each([
    ['an empty file', '', 'not valid JSON'],
    ['a null document', 'null', 'data.json: expected an object'],
    ['an array', '[]', 'data.json: expected an object'],
  ])('rejects %s', (_label, text, expected) => {
    const result = parseProjectFile(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain(expected)
  })

  it('names the missing field when a V2 document is hand-bumped to V3', () => {
    // The message *is* the versioning scheme working: V2 quests carry no hue, so claiming to
    // be V3 asks the V3 reader for a field the writer never wrote, and it says which.
    const data = v2Document()
    data.schemaVersion = 3
    expect(rejectionMessage(data)).toBe('quests[0].hue: expected a finite number')
  })

  it('points at the offending vertex when a polygon holds bare numbers', () => {
    const data = validDocument()
    const zones = data.zones as Record<string, unknown>[]
    zones[0].polygon = [1, 2, 3]
    expect(rejectionMessage(data)).toBe('zones[0].polygon[0]: expected an object')
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

    // `savedAt` is restamped by every write by design, so it is the one field allowed to
    // differ — everything else, including the ids the migration minted, must survive.
    const withoutSavedAt = (text: string): string =>
      text.replace(/"savedAt": "[^"]*"/g, '"savedAt": "<stamped>"')
    expect(withoutSavedAt(serializeProject(reread.file))).toBe(withoutSavedAt(firstSave))
    expect(reread.file.schemaVersion).toBe(5)
  })
})

describe('parseProjectFile: repairs dangling references rather than rejecting', () => {
  /** Fails the test if the document is rejected, so every repair case asserts on a real file. */
  function repaired(data: unknown): Extract<ParseResult, { ok: true }> {
    const result = parseProjectFile(JSON.stringify(data))
    if (!result.ok) throw new Error(`expected the document to parse, but: ${result.message}`)
    return result
  }

  it('reports no repairs for a document whose references all resolve', () => {
    expect(repaired(validDocument()).repairs).toEqual({ kind: 'none' })
  })

  it('drops a dialogue whose mapId names no map, and the quest links to it', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].mapId = 'map-gone'

    const result = repaired(data)
    expect(result.file.dialogues.map((dialogue) => dialogue.id)).toEqual([
      'dialogue-2',
      'dialogue-3',
      'dialogue-4',
    ])
    // 'dialogue-1' went with the dialogue it named; 'dialogue-4' survives untouched.
    expect(result.file.quests[0].dialogueIds).toEqual(['dialogue-4'])
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 1,
      zones: 0,
      questDialogueIds: 1,
      relevance: 0,
    })
  })

  it('drops a zone whose mapId names no map and leaves everything else standing', () => {
    const data = validDocument()
    const zones = data.zones as Record<string, unknown>[]
    zones[0].mapId = 'map-gone'

    const result = repaired(data)
    expect(result.file.zones).toEqual([])
    expect(result.file.dialogues).toHaveLength(4)
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 0,
      zones: 1,
      questDialogueIds: 0,
      relevance: 0,
    })
  })

  it('drops a quest reference that names no dialogue and keeps the quest', () => {
    const data = validDocument()
    const quests = data.quests as Record<string, unknown>[]
    quests[0].dialogueIds = ['dialogue-1', 'dialogue-gone', 'dialogue-4']

    const result = repaired(data)
    expect(result.file.quests).toHaveLength(1)
    expect(result.file.quests[0].dialogueIds).toEqual(['dialogue-1', 'dialogue-4'])
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 0,
      zones: 0,
      questDialogueIds: 1,
      relevance: 0,
    })
  })

  it('drops a dialogue relevance id naming no tag, rather than rejecting the document', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].relevance = ['worldbuilding', 'tag-gone']

    const result = repaired(data)
    expect(result.file.dialogues[0].relevance).toEqual(['worldbuilding'])
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 0,
      zones: 0,
      questDialogueIds: 0,
      relevance: 1,
    })
  })

  it('counts every dropped record when a whole map is missing', () => {
    const data = validDocument()
    // The one map the document has, gone: every zone and every dialogue dangles at once.
    data.maps = []

    const result = repaired(data)
    expect(result.file.dialogues).toEqual([])
    expect(result.file.zones).toEqual([])
    expect(result.file.quests[0].dialogueIds).toEqual([])
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 4,
      zones: 1,
      questDialogueIds: 2,
      relevance: 0,
    })
  })

  it('hands back a document that re-parses with nothing left to repair', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].mapId = 'map-gone'

    const reread = parseProjectFile(serializeProject(repaired(data).file))
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.repairs).toEqual({ kind: 'none' })
  })

  it('repairs a V1 document too, after the migration chain has run', () => {
    const data = v1Document()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].mapId = 'map-gone'

    const result = repaired(data)
    expect(result.file.schemaVersion).toBe(5)
    expect(result.file.dialogues.some((dialogue) => dialogue.mapId === 'map-gone')).toBe(false)
    expect(result.repairs.kind).toBe('repaired')
  })

  it('does not reject over a file name only a dropped record still claims', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    // A copy-pasted block, pointing at a map that is gone *and* at a file another dialogue
    // owns. Uniqueness is checked after the repair, so the surviving document decides.
    dialogues.push({
      ...dialogues[2],
      id: 'dialogue-5',
      mapId: 'map-gone',
    })

    const result = repaired(data)
    expect(result.file.dialogues.map((dialogue) => dialogue.id)).not.toContain('dialogue-5')
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 1,
      zones: 0,
      questDialogueIds: 0,
      relevance: 0,
    })
  })
})

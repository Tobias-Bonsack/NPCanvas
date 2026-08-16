import { describe, expect, it } from 'vitest'
import { MAP_LAYOUT_GAP } from '../map/canvas-layout.ts'
import { QUEST_HUES } from '../quest/quest-style.ts'
import { createEmptyProject, parseProjectFile, serializeProject } from './data-file.ts'

// A document exercising every branch of the reader: a line with no pictures, all three media
// kinds, a polygon and a quest. Rebuilt per test so a mutation cannot leak into the next case.
function validDocument(): Record<string, unknown> {
  return {
    schemaVersion: 4,
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

  it('normalises relevance to RELEVANCE_TAGS order without duplicates', () => {
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
    data.schemaVersion = 5
    expect(rejectionMessage(data)).toBe('schemaVersion: expected 1, 2, 3 or 4, but found 5')
  })

  it('rejects a map with no placement', () => {
    const data = validDocument()
    const maps = data.maps as Record<string, unknown>[]
    delete maps[0].origin
    expect(rejectionMessage(data)).toBe('maps[0].origin: expected an object')
  })

  it('round trips a V4 document with its placements and quest hues unchanged', () => {
    const result = parseProjectFile(JSON.stringify(validDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(4)
    expect(result.file.maps[0].origin).toEqual({ x: -400, y: 250 })
    expect(result.file.maps[0].scale).toBe(0.75)
    expect(result.file.quests[0].hue).toBe(45)

    const rewritten = parseProjectFile(serializeProject(result.file))
    expect(rewritten.ok).toBe(true)
    if (!rewritten.ok) return
    expect(rewritten.file.maps).toEqual(result.file.maps)
    expect(rewritten.file.quests).toEqual(result.file.quests)
    expect(rewritten.file.dialogues).toEqual(result.file.dialogues)
  })
})

/**
 * A V3 document: one exclusive content slot per dialogue, and no capture profiles. All four old
 * kinds, because the V3→V4 migration has a branch per kind.
 */
function v3Document(): Record<string, unknown> {
  const data = validDocument()
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
    { ...map, id: 'map-2', name: 'Caves', width: 800, height: 600 },
    { ...map, id: 'map-3', name: 'Keep', width: 1200, height: 400 },
  ]
  return data
}

describe('parseProjectFile: V3 migration', () => {
  it('splits every old content kind into a line and its pictures', () => {
    const result = parseProjectFile(JSON.stringify(v3Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(4)
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

    expect(result.file.schemaVersion).toBe(4)
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
  it('chains V1 through V2 and V3 to V4, placing the maps and colouring the quests', () => {
    const result = parseProjectFile(JSON.stringify(v1Document()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.schemaVersion).toBe(4)
    expect(result.file.dialogues).toHaveLength(4)
    expect(result.file.dialogues[0]).toMatchObject({ text: 'The tide took it.', media: [] })
    expect(result.file.dialogues[3].media[0]).toMatchObject({ kind: 'video', durationMs: 4200 })
    expect(result.file.captureProfiles).toEqual([])
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
    expect(result.file).toMatchObject({ schemaVersion: 4, maps: [] })
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

  it('rejects a relevance tag outside RELEVANCE_TAGS', () => {
    const data = validDocument()
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
})

describe('createEmptyProject', () => {
  it('writes the current schema version, so a new project is never migrated on its first read', () => {
    const project = createEmptyProject('Harbour')
    expect(project.schemaVersion).toBe(4)
    expect(project.captureProfiles).toEqual([])

    const reread = parseProjectFile(serializeProject(project))
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.file.schemaVersion).toBe(4)
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

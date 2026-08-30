import { describe, expect, it } from 'vitest'
import { MAX_MAP_SCALE, MIN_MAP_SCALE } from '../map/canvas-layout.ts'
import type { ParseResult } from './data-file.ts'
import { createEmptyProject, parseProjectFile, serializeProject } from './data-file.ts'

// Exercises every reader branch; rebuilt per test to avoid cross-test mutation.
function validDocument(): Record<string, unknown> {
  return {
    schemaVersion: 11,
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
        references: [],
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
        references: [],
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
        references: [],
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
        references: ['dialogue-1'],
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
    glyphs: [],
    pendingCaptures: [],
    recorderBindings: [
      { action: 'record-new', buttonIndex: 0 },
      { action: 'record-extend', buttonIndex: 1 },
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
    expect(result.file.dialogues[3].references).toEqual(['dialogue-1'])
    expect(result.file.quests[0].dialogueIds).toEqual(['dialogue-1', 'dialogue-4'])
    expect(result.file.recorderBindings).toEqual([
      { action: 'record-new', buttonIndex: 0 },
      { action: 'record-extend', buttonIndex: 1 },
    ])

    const roundTripped = parseProjectFile(serializeProject(result.file))
    expect(roundTripped.ok).toBe(true)
    if (!roundTripped.ok) return
    expect({ ...roundTripped.file, savedAt: '' }).toEqual({ ...result.file, savedAt: '' }) // savedAt is restamped on every write
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
    const result = parseProjectFile('{ "schemaVersion": 11, ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('not valid JSON')
  })

  it('rejects an unsupported schemaVersion, naming both the version read and the version expected', () => {
    const data = validDocument()
    data.schemaVersion = 12
    expect(rejectionMessage(data)).toBe('schemaVersion: expected 11, but found 12')
  })

  it('rejects a document at a version this app can no longer read', () => {
    const data = validDocument()
    data.schemaVersion = 10
    expect(rejectionMessage(data)).toBe('schemaVersion: expected 11, but found 10')
  })

  it('rejects a map with no placement', () => {
    const data = validDocument()
    const maps = data.maps as Record<string, unknown>[]
    delete maps[0].origin
    expect(rejectionMessage(data)).toBe('maps[0].origin: expected an object')
  })
})

describe('parseProjectFile: recorderBindings', () => {
  it('reads a binding for each action', () => {
    const result = parseProjectFile(JSON.stringify(validDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.recorderBindings).toEqual([
      { action: 'record-new', buttonIndex: 0 },
      { action: 'record-extend', buttonIndex: 1 },
    ])
  })

  it('round trips a binding unchanged', () => {
    const result = parseProjectFile(JSON.stringify(validDocument()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const reread = parseProjectFile(serializeProject(result.file))
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.file.recorderBindings).toEqual(result.file.recorderBindings)
  })

  it('collapses a duplicate action to its first binding, mirroring the reducer’s own rule', () => {
    const data = validDocument()
    data.recorderBindings = [
      { action: 'record-new', buttonIndex: 0 },
      { action: 'record-new', buttonIndex: 4 },
    ]

    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.recorderBindings).toEqual([{ action: 'record-new', buttonIndex: 0 }])
  })

  it('rejects a buttonIndex that is not a non-negative integer', () => {
    const data = validDocument()
    data.recorderBindings = [{ action: 'record-new', buttonIndex: -1 }]
    expect(rejectionMessage(data)).toBe(
      'recorderBindings[0].buttonIndex: expected a non-negative integer',
    )
  })

  it('rejects a fractional buttonIndex', () => {
    const data = validDocument()
    data.recorderBindings = [{ action: 'record-new', buttonIndex: 1.5 }]
    expect(rejectionMessage(data)).toBe(
      'recorderBindings[0].buttonIndex: expected a non-negative integer',
    )
  })

  it('rejects an unknown action', () => {
    const data = validDocument()
    data.recorderBindings = [{ action: 'record-forever', buttonIndex: 0 }]
    expect(rejectionMessage(data)).toBe(
      'recorderBindings[0].action: expected record-new or record-extend or cycle-profile',
    )
  })
})

describe('parseProjectFile: field validation', () => {
  it.each([
    [
      'a missing field',
      (data: Record<string, unknown>) => {
        delete data.projectName
      },
      'projectName: expected a string',
    ],
    [
      'a mistyped field',
      (data: Record<string, unknown>) => {
        ;(data.maps as Record<string, unknown>[])[0].width = '2000'
      },
      'maps[0].width: expected a finite number',
    ],
    [
      'a polygon with fewer than three points',
      (data: Record<string, unknown>) => {
        ;(data.zones as Record<string, unknown>[])[0].polygon = [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]
      },
      'zones[0].polygon: expected at least 3 points',
    ],
    [
      'an unknown dialogue media kind',
      (data: Record<string, unknown>) => {
        ;(data.dialogues as Record<string, unknown>[])[2].media = [
          { id: 'media-3', kind: 'audio', file: {}, width: 1, height: 1 },
        ]
      },
      'dialogues[2].media[0].kind: expected one of image, gif, video',
    ],
    [
      'a medium with no id, so nothing can address it later',
      (data: Record<string, unknown>) => {
        const media = (data.dialogues as Record<string, unknown>[])[2].media as Record<
          string,
          unknown
        >[]
        delete media[0].id
      },
      'dialogues[2].media[0].id: expected a string',
    ],
    [
      'a quest status outside open and done',
      (data: Record<string, unknown>) => {
        ;(data.quests as Record<string, unknown>[])[0].status = 'abandoned'
      },
      'quests[0].status: expected open or done',
    ],
    [
      'a capture profile whose rect is not a rect',
      (data: Record<string, unknown>) => {
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
          },
        ]
      },
      'captureProfiles[0].screenRect.height: expected a finite number',
    ],
    [
      'a relevance tag hue outside 0..359',
      (data: Record<string, unknown>) => {
        ;(data.relevanceTags as Record<string, unknown>[])[0].hue = 400
      },
      'relevanceTags[0].hue: expected a hue in 0..359',
    ],
    [
      'a relevance tag with no name',
      (data: Record<string, unknown>) => {
        delete (data.relevanceTags as Record<string, unknown>[])[0].name
      },
      'relevanceTags[0].name: expected a string',
    ],
  ])('rejects %s', (_label, mutate, message) => {
    const data = validDocument()
    mutate(data)
    expect(rejectionMessage(data)).toBe(message)
  })
})

/** A valid document whose `pendingCaptures` carries one capture with a picture and a tag. */
function documentWithPendingCapture(): Record<string, unknown> {
  const data = validDocument()
  data.pendingCaptures = [
    {
      id: 'capture-1',
      npcName: 'NPC 1',
      text: 'Have you seen my boat?',
      media: [
        {
          id: 'media-c1',
          kind: 'image',
          file: { fileName: 'capture-1-media-c1.png', mimeType: 'image/png', byteSize: 512 },
          width: 400,
          height: 300,
        },
      ],
      spokenAt: '2026-08-14T09:00:00.000Z',
      relevance: ['worldbuilding'],
    },
  ]
  return data
}

describe('parseProjectFile: pendingCaptures', () => {
  it('reads a capture verbatim — no mapId, no position, its own media and relevance', () => {
    const result = parseProjectFile(JSON.stringify(documentWithPendingCapture()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.file.pendingCaptures).toHaveLength(1)
    const [capture] = result.file.pendingCaptures
    expect(capture).not.toHaveProperty('mapId')
    expect(capture).not.toHaveProperty('position')
    expect(capture.npcName).toBe('NPC 1')
    expect(capture.text).toBe('Have you seen my boat?')
    expect(capture.media).toHaveLength(1)
    expect(capture.media[0]).toMatchObject({ kind: 'image', width: 400, height: 300 })
    expect(capture.relevance).toEqual(
      result.file.relevanceTags.filter((tag) => tag.name === 'Worldbuilding').map((tag) => tag.id),
    )
  })

  it('rejects two captures sharing an id', () => {
    const data = documentWithPendingCapture()
    const captures = data.pendingCaptures as Record<string, unknown>[]
    data.pendingCaptures = [captures[0], { ...captures[0] }]
    expect(rejectionMessage(data)).toBe(
      'pendingCaptures[1].id: expected an id not already used, but "capture-1" is',
    )
  })

  it('rejects a file a dialogue already claims', () => {
    const data = documentWithPendingCapture()
    const captures = data.pendingCaptures as Record<string, unknown>[]
    const media = captures[0].media as Record<string, unknown>[]
    ;(media[0].file as Record<string, unknown>).fileName = 'dialogue-2-media-2a.png'
    expect(rejectionMessage(data)).toBe(
      'pendingCaptures[0].media[0].file.fileName: expected a file no other record names, but ' +
        '"dialogue-2-media-2a.png" is taken',
    )
  })

  it('repairs a capture’s relevance id that names no current tag, without dropping the capture', () => {
    const data = documentWithPendingCapture()
    const captures = data.pendingCaptures as Record<string, unknown>[]
    captures[0].relevance = ['worldbuilding', 'a-deleted-tag']

    const result = parseProjectFile(JSON.stringify(data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.pendingCaptures).toHaveLength(1)
    expect(result.file.pendingCaptures[0].relevance).toEqual(
      result.file.relevanceTags.filter((tag) => tag.name === 'Worldbuilding').map((tag) => tag.id),
    )
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 0,
      zones: 0,
      questDialogueIds: 0,
      relevance: 1,
      dialogueReferences: 0,
    })
  })

  it('round trips a document with a pending capture unchanged', () => {
    const result = parseProjectFile(JSON.stringify(documentWithPendingCapture()))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const reread = parseProjectFile(serializeProject(result.file))
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.file.pendingCaptures).toEqual(result.file.pendingCaptures)
  })
})

describe('createEmptyProject', () => {
  it('writes the current schema version, so a new project is never migrated on its first read', () => {
    const project = createEmptyProject('Harbour')
    expect(project.schemaVersion).toBe(11)
    expect(project.captureProfiles).toEqual([])
    expect(project.glyphs).toEqual([])
    expect(project.pendingCaptures).toEqual([])
    expect(project.recorderBindings).toEqual([])
    expect(project.relevanceTags.map((tag) => tag.name)).toEqual([
      'Out of world',
      'Worldbuilding',
      'Peoplebuilding',
      'Other',
    ])

    const reread = parseProjectFile(serializeProject(project))
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.file.schemaVersion).toBe(11)
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
    expect(written.file.savedAt >= before).toBe(true) // ISO 8601 sorts chronologically
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
  ])('rejects two %s sharing an id, naming the id of the appended duplicate', (key, id) => {
    const data = validDocument()
    const records = data[key] as Record<string, unknown>[]
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

  it('points at the offending vertex when a polygon holds bare numbers', () => {
    const data = validDocument()
    const zones = data.zones as Record<string, unknown>[]
    zones[0].polygon = [1, 2, 3]
    expect(rejectionMessage(data)).toBe('zones[0].polygon[0]: expected an object')
  })
})

describe('parseProjectFile: repairs dangling references rather than rejecting', () => {
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
    expect(result.file.quests[0].dialogueIds).toEqual(['dialogue-4'])
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 1,
      zones: 0,
      questDialogueIds: 1,
      relevance: 0,
      dialogueReferences: 1, // dialogue-4's reference to the now-gone dialogue-1
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
      dialogueReferences: 0,
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
      dialogueReferences: 0,
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
      dialogueReferences: 0,
    })
  })

  it('drops a dialogue reference naming a dialogue that is gone', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].references = ['dialogue-2', 'dialogue-gone']

    const result = repaired(data)
    expect(result.file.dialogues[0].references).toEqual(['dialogue-2'])
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 0,
      zones: 0,
      questDialogueIds: 0,
      relevance: 0,
      dialogueReferences: 1,
    })
  })

  it('drops a self-reference rather than rejecting the document', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    dialogues[0].references = ['dialogue-1', 'dialogue-2']

    const result = repaired(data)
    expect(result.file.dialogues[0].references).toEqual(['dialogue-2'])
    expect(result.repairs).toEqual({
      kind: 'repaired',
      dialogues: 0,
      zones: 0,
      questDialogueIds: 0,
      relevance: 0,
      dialogueReferences: 1,
    })
  })

  it("counts every dropped record when the document's one map is missing, dangling every zone and dialogue at once", () => {
    const data = validDocument()
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
      dialogueReferences: 0,
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

  it('does not reject over a file name only a dropped record still claims', () => {
    const data = validDocument()
    const dialogues = data.dialogues as Record<string, unknown>[]
    // Points at a gone map *and* a file another dialogue owns — uniqueness is checked post-repair.
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
      dialogueReferences: 0,
    })
  })
})

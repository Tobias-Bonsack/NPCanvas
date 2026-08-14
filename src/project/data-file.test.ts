import { describe, expect, it } from 'vitest'
import { parseProjectFile, serializeProject } from './data-file.ts'

// A document exercising every branch of the reader: all four content kinds, a polygon, a
// quest, and a media file. Rebuilt per test so a mutation cannot leak into the next case.
function validDocument(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectName: 'Fisherman’s Rest',
    savedAt: '2026-08-14T10:00:00.000Z',
    maps: [
      {
        id: 'map-1',
        name: 'Overworld',
        file: { fileName: 'map-1.png', mimeType: 'image/png', byteSize: 204800 },
        width: 2000,
        height: 1500,
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
    ],
    quests: [
      {
        id: 'quest-1',
        name: 'Recover the net',
        status: 'open',
        dialogueIds: ['dialogue-1', 'dialogue-4'],
        note: 'Ask at the harbour first.',
      },
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
    expect(result.file.dialogues.map((dialogue) => dialogue.content.kind)).toEqual([
      'text',
      'image',
      'gif',
      'video',
    ])
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
    data.schemaVersion = 2
    expect(rejectionMessage(data)).toContain('schemaVersion')
  })

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

  it('rejects an unknown dialogue content kind', () => {
    const data = validDocument()
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

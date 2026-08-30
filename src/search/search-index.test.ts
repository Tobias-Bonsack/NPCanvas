import { describe, expect, it } from 'vitest'
import { rectToPolygon } from '../map/geometry.ts'
import { createEmptyProject } from '../project/data-file.ts'
import { asDialogueId, asMapId, asQuestId, asZoneId } from '../project/ids.ts'
import type { Dialogue, MapId, ProjectFile, Quest, Zone } from '../project/types.ts'
import { dialogueSearchText } from './dialogue-search-text.ts'
import { searchProject } from './search-index.ts'

const OVERWORLD = asMapId('overworld')

function dialogue(id: string, npcName: string, text: string, mapId: MapId = OVERWORLD): Dialogue {
  return {
    id: asDialogueId(id),
    mapId,
    npcName,
    position: { x: 0, y: 0 },
    text,
    media: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
    relevance: [],
    references: [],
  }
}

function quest(id: string, name: string, dialogueIds: string[] = []): Quest {
  return {
    id: asQuestId(id),
    name,
    status: 'open',
    dialogueIds: dialogueIds.map(asDialogueId),
    note: '',
    hue: 200,
  }
}

function zone(id: string, name: string, mapId: MapId = OVERWORLD): Zone {
  return {
    id: asZoneId(id),
    mapId,
    name,
    polygon: rectToPolygon({ x: 0, y: 0, width: 10, height: 10 }),
    hue: 200,
  }
}

function project(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return { ...createEmptyProject('Test project'), ...overrides }
}

describe('dialogueSearchText', () => {
  it('matches on the NPC name and on what was said', () => {
    const line = dialogue('d1', 'Innkeeper', 'The road north is closed.')
    expect(dialogueSearchText(line)).toContain('innkeeper')
    expect(dialogueSearchText(line)).toContain('road north is closed')
  })
})

describe('searchProject', () => {
  it('matches nothing for an empty or whitespace-only query', () => {
    const proj = project({ dialogues: [dialogue('d1', 'Innkeeper', 'Hello there')] })
    expect(searchProject(proj, '')).toEqual({ results: [], hiddenCount: 0 })
    expect(searchProject(proj, '   ')).toEqual({ results: [], hiddenCount: 0 })
  })

  it('finds a dialogue by NPC name and by what was said, case-insensitively', () => {
    const line = dialogue('d1', 'Innkeeper', 'The road north is closed.')
    const proj = project({ dialogues: [line] })
    // 'INNKEEPER' also names the NPC, which is a real result in its own right — see the
    // grouping test below for that case in isolation.
    expect(searchProject(proj, 'INNKEEPER').results[0]).toEqual({ kind: 'dialogue', dialogue: line })
    expect(searchProject(proj, 'road north').results).toEqual([{ kind: 'dialogue', dialogue: line }])
  })

  it('finds an NPC by name, once, with its line count', () => {
    const proj = project({
      dialogues: [
        dialogue('d1', 'Innkeeper', 'Hello there'),
        dialogue('d2', 'Innkeeper', 'Safe travels'),
      ],
    })
    const npcHits = searchProject(proj, 'keeper').results.filter((r) => r.kind === 'npc')
    expect(npcHits).toEqual([{ kind: 'npc', key: 'Innkeeper', lineCount: 2 }])
  })

  it('finds a quest by name, falling back to "Untitled quest" for a blank one', () => {
    const proj = project({ quests: [quest('q1', 'The Lost Professor')] })
    expect(searchProject(proj, 'lost').results).toEqual([
      { kind: 'quest', quest: proj.quests[0] },
    ])
    expect(searchProject(project({ quests: [quest('q2', '')] }), 'untitled').results).toEqual([
      { kind: 'quest', quest: expect.objectContaining({ id: asQuestId('q2') }) },
    ])
  })

  it('finds a zone by name', () => {
    const proj = project({ zones: [zone('z1', 'Alabastia')] })
    expect(searchProject(proj, 'alaba').results).toEqual([{ kind: 'zone', zone: proj.zones[0] }])
  })

  it('groups dialogues before NPCs before quests before zones', () => {
    const proj = project({
      dialogues: [dialogue('d1', 'Sandan', 'Sandan was here')],
      quests: [quest('q1', 'Sandan the Wanderer')],
      zones: [zone('z1', 'Sandan Isle')],
    })
    expect(searchProject(proj, 'sandan').results.map((r) => r.kind)).toEqual([
      'dialogue',
      'npc',
      'quest',
      'zone',
    ])
  })

  it('caps results and reports how many were hidden', () => {
    // 35 dialogue hits plus one NPC hit for the shared name is 36 total, 6 past the cap.
    const dialogues = Array.from({ length: 35 }, (_, index) =>
      dialogue(`d${index}`, 'Innkeeper', `Line ${index}`),
    )
    const outcome = searchProject(project({ dialogues }), 'innkeeper')
    expect(outcome.results).toHaveLength(30)
    expect(outcome.hiddenCount).toBe(6)
  })

  it('reports no hidden results when nothing was cut', () => {
    const proj = project({ dialogues: [dialogue('d1', 'Innkeeper', 'Hello')] })
    expect(searchProject(proj, 'innkeeper').hiddenCount).toBe(0)
  })
})

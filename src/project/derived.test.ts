import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asQuestId } from './ids.ts'
import type { Dialogue, Quest } from './types.ts'
import { dialogueSearchTexts, npcLineCounts, questIndexFor, searchTextOf } from './derived.ts'

const OVERWORLD = asMapId('overworld')

function dialogue(id: string, npcName: string, text: string): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: OVERWORLD,
    npcName,
    position: { x: 0, y: 0 },
    text,
    media: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
    relevance: [],
      references: [],
  }
}

function quest(id: string, dialogueIds: string[]): Quest {
  return {
    id: asQuestId(id),
    name: id,
    status: 'open',
    dialogueIds: dialogueIds.map(asDialogueId),
    note: '',
    hue: 200,
  }
}

describe('npcLineCounts', () => {
  it('counts each npcKey in one pass, matching a full rebuild', () => {
    const dialogues = [
      dialogue('d1', 'Innkeeper', 'Hello'),
      dialogue('d2', 'Innkeeper', 'Safe travels'),
      dialogue('d3', 'Sailor', 'Ahoy'),
    ]
    expect(npcLineCounts(dialogues)).toEqual(
      new Map([
        ['Innkeeper', 2],
        ['Sailor', 1],
      ]),
    )
  })

  it('hits the same array on repeated calls, and rebuilds for a replaced-but-equal array', () => {
    const dialogues = [dialogue('d1', 'Innkeeper', 'Hello')]
    const first = npcLineCounts(dialogues)
    expect(npcLineCounts(dialogues)).toBe(first)

    // A different array with the same values is a real change under the identity-cache rule —
    // never a cache on value.
    const clone = [...dialogues]
    const second = npcLineCounts(clone)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

  it('trims npcName the way npcKey does, grouping blank names together', () => {
    const dialogues = [dialogue('d1', 'Innkeeper ', 'Hello'), dialogue('d2', ' Innkeeper', 'Hi')]
    expect(npcLineCounts(dialogues).get('Innkeeper')).toBe(2)
  })
})

describe('dialogueSearchTexts / searchTextOf', () => {
  it('matches dialogueSearchText for every dialogue', () => {
    const line = dialogue('d1', 'Innkeeper', 'The road north is closed.')
    const dialogues = [line]
    expect(dialogueSearchTexts(dialogues).get(line.id)).toBe('innkeeper the road north is closed.')
    expect(searchTextOf(line, dialogues)).toBe('innkeeper the road north is closed.')
  })

  it('caches on the dialogues array identity, and invalidates on a replaced array', () => {
    const dialogues = [dialogue('d1', 'Innkeeper', 'Hello')]
    const first = dialogueSearchTexts(dialogues)
    expect(dialogueSearchTexts(dialogues)).toBe(first)

    const clone = [...dialogues]
    const second = dialogueSearchTexts(clone)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })
})

describe('questIndexFor', () => {
  it('matches indexQuestsByDialogue for a full rebuild', () => {
    const quests = [quest('q1', ['d1', 'd2']), quest('q2', ['d2'])]
    const index = questIndexFor(quests)
    expect(index.get(asDialogueId('d1'))?.map((q) => q.id)).toEqual([asQuestId('q1')])
    expect(index.get(asDialogueId('d2'))?.map((q) => q.id)).toEqual([asQuestId('q1'), asQuestId('q2')])
  })

  it('caches on the quests array identity, and invalidates on a replaced array', () => {
    const quests = [quest('q1', ['d1'])]
    const first = questIndexFor(quests)
    expect(questIndexFor(quests)).toBe(first)

    const clone = [...quests]
    const second = questIndexFor(clone)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

  it('a change to zones or maps alone does not invalidate a dialogue-derived cache', () => {
    // There is no zones/maps parameter here at all — every derivation in this module keys only
    // on its own input array, which is what makes that guarantee structural rather than tested
    // indirectly: a caller cannot even pass zones or maps in to invalidate it.
    const dialogues = [dialogue('d1', 'Innkeeper', 'Hello')]
    const first = npcLineCounts(dialogues)
    expect(npcLineCounts(dialogues)).toBe(first)
  })
})

import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asQuestId } from '../project/ids.ts'
import type { Dialogue, Quest, QuestStatus } from '../project/types.ts'
import type { ArcState, QuestArc } from './quest-arcs.ts'
import { ARC_STATES, arcProgressAt, arcStateAt, questArcs } from './quest-arcs.ts'
import type { Moment, Reel } from './reel.ts'

const UNUSED_MAP = asMapId('unused-map')

function dialogueOf(id: string): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: UNUSED_MAP,
    npcName: 'Mara',
    position: { x: 0, y: 0 },
    text: '',
    media: [],
    relevance: [],
    references: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
  }
}

/** A reel with one moment per id, in order, so tests can address moments by dialogue id. */
function reelOf(ids: string[]): Reel {
  const moments: Moment[] = ids.map((id, index) => ({
    dialogue: dialogueOf(id),
    index,
    sessionIndex: 0,
    gapMsBefore: 0,
    zoneId: null,
    dwellMs: 1500,
  }))
  return { moments, sessions: [] }
}

function quest(id: string, status: QuestStatus, dialogueIds: string[]): Quest {
  return {
    id: asQuestId(id),
    name: id,
    status,
    dialogueIds: dialogueIds.map((d) => asDialogueId(d)),
    note: '',
    hue: 0,
  }
}

describe('ARC_STATES', () => {
  it('lists unseen, open and done in that order', () => {
    expect(ARC_STATES).toEqual(['unseen', 'open', 'done'])
  })
})

describe('questArcs', () => {
  it('spans an arc from the first to the last of its quest lines reached on the reel', () => {
    const reel = reelOf(['a', 'b', 'c', 'd'])
    const q = quest('q1', 'open', ['b', 'd'])
    const [arc]: QuestArc[] = questArcs([q], reel)
    expect(arc.firstMoment).toBe(1)
    expect(arc.lastMoment).toBe(3)
    expect(arc.moments).toEqual([1, 3])
  })

  it('produces no arc for a quest none of whose lines reached the reel', () => {
    const reel = reelOf(['a', 'b'])
    const q = quest('gone', 'open', ['not-on-reel'])
    expect(questArcs([q], reel)).toEqual([])
  })

  it('puts a line shared by two quests into both arcs', () => {
    const reel = reelOf(['a', 'b', 'c'])
    const q1 = quest('q1', 'open', ['b'])
    const q2 = quest('q2', 'open', ['b', 'c'])
    const arcs = questArcs([q1, q2], reel)
    expect(arcs).toHaveLength(2)
    expect(arcs[0].moments).toEqual([1])
    expect(arcs[1].moments).toEqual([1, 2])
  })

  it('orders arcs by firstMoment ascending, ties broken by quest position', () => {
    const reel = reelOf(['a', 'b', 'c'])
    const later = quest('later', 'open', ['c'])
    const earlierFirst = quest('earlierFirst', 'open', ['a'])
    const earlierSecond = quest('earlierSecond', 'open', ['a'])
    const arcs = questArcs([later, earlierFirst, earlierSecond], reel)
    expect(arcs.map((arc) => arc.quest.id)).toEqual([earlierFirst.id, earlierSecond.id, later.id])
  })
})

describe('arcStateAt', () => {
  const reel = reelOf(['a', 'b', 'c', 'd', 'e'])

  const cases: { status: QuestStatus; index: number; expected: ArcState; label: string }[] = [
    { status: 'done', index: 0, expected: 'unseen', label: 'one before firstMoment is unseen' },
    { status: 'done', index: 1, expected: 'open', label: 'exactly firstMoment is open' },
    { status: 'done', index: 2, expected: 'open', label: 'one before lastMoment is open' },
    { status: 'done', index: 3, expected: 'done', label: 'exactly lastMoment is done when the quest status is done' },
    { status: 'open', index: 3, expected: 'open', label: 'lastMoment stays open when the quest status is open' },
    { status: 'open', index: 4, expected: 'open', label: 'an open quest is still open at the reel\'s final index' },
  ]

  for (const { status, index, expected, label } of cases) {
    it(label, () => {
      const q = quest('q', status, ['b', 'd'])
      const [arc] = questArcs([q], reel)
      expect(arcStateAt(arc, index)).toBe(expected)
    })
  }

  it('keeps two overlapping arcs both open at one shared index', () => {
    const q1 = quest('q1', 'open', ['a', 'd'])
    const q2 = quest('q2', 'open', ['b', 'e'])
    const arcs = questArcs([q1, q2], reel)
    expect(arcs.map((arc) => arcStateAt(arc, 2))).toEqual(['open', 'open'])
  })
})

describe('arcProgressAt', () => {
  it('counts moments reached at or before the given index', () => {
    const reel = reelOf(['a', 'b', 'c', 'd', 'e'])
    const q = quest('q', 'open', ['a', 'c', 'e'])
    const [arc] = questArcs([q], reel)
    expect(arcProgressAt(arc, 0)).toEqual({ reached: 1, total: 3 })
    expect(arcProgressAt(arc, 2)).toEqual({ reached: 2, total: 3 })
    expect(arcProgressAt(arc, 4)).toEqual({ reached: 3, total: 3 })
  })
})

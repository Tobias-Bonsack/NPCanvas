import { describe, expect, it } from 'vitest'
import { asQuestId } from '../project/ids.ts'
import type { Quest, QuestStatus } from '../project/types.ts'
import { QUEST_DONE_HUE, QUEST_HUES, nextQuestHue, questAccentHue } from './quest-style.ts'

function quest(id: string, hue: number, status: QuestStatus = 'open'): Quest {
  return {
    id: asQuestId(id),
    name: id,
    status,
    dialogueIds: [],
    note: '',
    hue,
  }
}

describe('QUEST_HUES', () => {
  // The reserved band is what makes a green flag mean "done" and nothing else.
  it('leaves the 110-175 band to QUEST_DONE_HUE', () => {
    expect(QUEST_HUES.filter((hue) => hue >= 110 && hue <= 175)).toEqual([])
    expect(QUEST_DONE_HUE).toBeGreaterThanOrEqual(110)
    expect(QUEST_DONE_HUE).toBeLessThanOrEqual(175)
  })
})

describe('nextQuestHue', () => {
  it('hands out the palette in order while it lasts', () => {
    expect(nextQuestHue([])).toBe(QUEST_HUES[0])
    expect(nextQuestHue([quest('a', QUEST_HUES[0])])).toBe(QUEST_HUES[1])
    expect(nextQuestHue([quest('a', QUEST_HUES[0]), quest('b', QUEST_HUES[1])])).toBe(QUEST_HUES[2])
  })

  it('fills a gap left by a deleted quest rather than skipping past it', () => {
    const quests = [quest('a', QUEST_HUES[0]), quest('c', QUEST_HUES[2])]
    expect(nextQuestHue(quests)).toBe(QUEST_HUES[1])
  })

  // Unlike zones, which are scoped per map: two quests can name the same dialogue, so their
  // flags share a pin and must not share a hue.
  it('is project-wide, so a done quest still holds its colour against a new one', () => {
    const quests = [quest('a', QUEST_HUES[0], 'done'), quest('b', QUEST_HUES[1])]
    expect(nextQuestHue(quests)).toBe(QUEST_HUES[2])
  })

  it('wraps once every hue is taken', () => {
    const quests = QUEST_HUES.map((hue, index) => quest(`q${index}`, hue))
    expect(QUEST_HUES).toContain(nextQuestHue(quests))
  })

  it('ignores a hue no palette entry uses, which a hand-edited document may carry', () => {
    expect(nextQuestHue([quest('a', 17)])).toBe(QUEST_HUES[0])
  })
})

describe('questAccentHue', () => {
  it('is the quest own hue while it is open', () => {
    expect(questAccentHue(quest('a', QUEST_HUES[3]))).toBe(QUEST_HUES[3])
  })

  it('is the done hue for a finished quest, whatever colour it was given', () => {
    for (const hue of QUEST_HUES) {
      expect(questAccentHue(quest('a', hue, 'done'))).toBe(QUEST_DONE_HUE)
    }
  })
})

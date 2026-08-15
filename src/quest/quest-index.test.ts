import { describe, expect, it } from 'vitest'
import { asDialogueId, asQuestId } from '../project/ids.ts'
import type { Quest, QuestStatus } from '../project/types.ts'
import { dialoguesInAnyQuest, indexQuestsByDialogue } from './quest-index.ts'

function quest(id: string, status: QuestStatus, dialogueIds: string[]): Quest {
  return {
    id: asQuestId(id),
    name: id,
    status,
    dialogueIds: dialogueIds.map(asDialogueId),
    note: '',
    hue: 45,
  }
}

/** `ledger` is in both quests, `rumour` only in the done one, `idle` in neither. */
const QUESTS: readonly Quest[] = [
  quest('quest-open', 'open', ['ledger', 'lantern']),
  quest('quest-done', 'done', ['ledger', 'rumour']),
]

describe('indexQuestsByDialogue', () => {
  it('inverts quests into dialogue buckets, in document order', () => {
    const index = indexQuestsByDialogue(QUESTS)
    expect(index.get(asDialogueId('ledger'))?.map((it) => it.id)).toEqual([
      'quest-open',
      'quest-done',
    ])
    expect(index.get(asDialogueId('lantern'))?.map((it) => it.id)).toEqual(['quest-open'])
    expect(index.get(asDialogueId('rumour'))?.map((it) => it.id)).toEqual(['quest-done'])
  })

  it('leaves a dialogue no quest names out of the index entirely', () => {
    const index = indexQuestsByDialogue(QUESTS)
    expect(index.has(asDialogueId('idle'))).toBe(false)
  })

  it('is empty for a project with no quests', () => {
    expect(indexQuestsByDialogue([]).size).toBe(0)
  })

  it('does not duplicate a dialogue a single quest lists twice', () => {
    // The reducer refuses a duplicate attach, but a hand-edited data.json can still hold one,
    // and the pin is honest about it: one flag per entry, as the document states it.
    const index = indexQuestsByDialogue([quest('quest-1', 'open', ['ledger', 'ledger'])])
    expect(index.get(asDialogueId('ledger'))?.length).toBe(2)
  })
})

describe('dialoguesInAnyQuest', () => {
  it('keeps every dialogue a quest names, whatever its status', () => {
    const linked = dialoguesInAnyQuest(indexQuestsByDialogue(QUESTS))
    expect([...linked].sort()).toEqual(['lantern', 'ledger', 'rumour'])
  })

  it('is empty for a project with no quests', () => {
    expect(dialoguesInAnyQuest(indexQuestsByDialogue([])).size).toBe(0)
  })
})

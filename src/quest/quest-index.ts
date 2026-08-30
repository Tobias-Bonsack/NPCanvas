import type { DialogueId, Quest } from '../project/types.ts'

// Inverted from the quests, so the canvas doesn't scan every quest's dialogueIds per pin.
// Unlike zone-index.ts, no entry means "named by nothing" — built from quests, not dialogues,
// so there's no second reading to confuse it with.
export function indexQuestsByDialogue(quests: readonly Quest[]): ReadonlyMap<DialogueId, Quest[]> {
  const index = new Map<DialogueId, Quest[]>()
  for (const quest of quests) {
    for (const dialogueId of quest.dialogueIds) {
      const bucket = index.get(dialogueId)
      if (bucket === undefined) index.set(dialogueId, [quest])
      else bucket.push(quest)
    }
  }
  return index
}

// Open and done alike — "pins that are part of some thread" is a question about the whole
// project, and hiding ones already dealt with would misreport it.
export function dialoguesInAnyQuest(
  index: ReadonlyMap<DialogueId, Quest[]>,
): ReadonlySet<DialogueId> {
  return new Set(index.keys())
}

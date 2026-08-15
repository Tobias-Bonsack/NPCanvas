import type { DialogueId, Quest } from '../project/types.ts'

/**
 * Which quests each dialogue belongs to, inverted from the quests in one pass.
 *
 * A `Quest` names its dialogues, so the canvas — which asks the question the other way round,
 * once per pin — would otherwise scan every quest's `dialogueIds` for every pin on screen.
 * Built once per document change and read O(1) per pin.
 *
 * Unlike `zone-index.ts` this index has **no entry for a dialogue in no quest**. It is built
 * from the quests rather than from the dialogues, so a missing key can only mean "named by
 * nothing" — there is no second reading to confuse it with.
 *
 * Quests keep the order they appear in the document, which is creation order: the board lists
 * them that way too, so a dialogue's quests and the board never disagree about sequence.
 */
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

/**
 * The dialogues named by at least one **open** quest — what a pin's quest marker means.
 *
 * Open only, because the marker's job is "this line is part of something you are still
 * chasing". A finished quest is history, and flagging its pins forever would leave the canvas
 * permanently marked.
 */
export function dialoguesInOpenQuests(
  index: ReadonlyMap<DialogueId, Quest[]>,
): ReadonlySet<DialogueId> {
  const marked = new Set<DialogueId>()
  for (const [dialogueId, quests] of index) {
    if (quests.some((quest) => quest.status === 'open')) marked.add(dialogueId)
  }
  return marked
}

/**
 * Every dialogue named by any quest, open or done — what the canvas highlight toggle keeps.
 *
 * Deliberately broader than the marker: filtering to "pins that are part of some thread" is a
 * question about the whole project, and hiding the ones already dealt with would misreport it.
 */
export function dialoguesInAnyQuest(
  index: ReadonlyMap<DialogueId, Quest[]>,
): ReadonlySet<DialogueId> {
  return new Set(index.keys())
}

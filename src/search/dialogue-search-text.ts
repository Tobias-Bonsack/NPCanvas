import type { Dialogue } from '../project/types.ts'

/**
 * Everything a dialogue is found by: NPC name and what was said, lowercased once per call. The
 * one substring predicate the insights filter, the quest attach picker and the search palette
 * all match against — see `filters.ts` and `QuestBoard.tsx`'s `DialoguePicker`, which import
 * this instead of each keeping their own copy.
 */
export function dialogueSearchText(dialogue: Dialogue): string {
  return `${dialogue.npcName} ${dialogue.text}`.toLowerCase()
}

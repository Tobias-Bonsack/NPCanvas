import { npcKey } from '../insights/filters.ts'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { dialogueSearchText } from '../search/dialogue-search-text.ts'
import type { Dialogue, DialogueId } from './types.ts'

// Each derivation caches on the identity of its own input array, never on `project` as a whole and
// never on value — the same discipline `zone-index.ts` applies, so a zone drag doesn't rebuild the
// dialogue-derived caches here.

function identityCache<TInput, TOutput>(build: (input: TInput) => TOutput): (input: TInput) => TOutput {
  let cached: { input: TInput; output: TOutput } | null = null
  return (input: TInput): TOutput => {
    if (cached !== null && cached.input === input) return cached.output
    const output = build(input)
    cached = { input, output }
    return output
  }
}

/** How many lines each NPC has, keyed by `npcKey`. */
export const npcLineCounts = identityCache(
  (dialogues: readonly Dialogue[]): ReadonlyMap<string, number> => {
    const counts = new Map<string, number>()
    for (const dialogue of dialogues) {
      const key = npcKey(dialogue)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  },
)

/** `dialogueSearchText` per dialogue, cached across the array instead of recomputed per keystroke. */
export const dialogueSearchTexts = identityCache(
  (dialogues: readonly Dialogue[]): ReadonlyMap<DialogueId, string> => {
    const texts = new Map<DialogueId, string>()
    for (const dialogue of dialogues) texts.set(dialogue.id, dialogueSearchText(dialogue))
    return texts
  },
)

export function searchTextOf(dialogue: Dialogue, dialogues: readonly Dialogue[]): string {
  return dialogueSearchTexts(dialogues).get(dialogue.id) ?? dialogueSearchText(dialogue)
}

export const questIndexFor = identityCache(indexQuestsByDialogue)

export function byId<T extends { id: PropertyKey }>(items: readonly T[]): ReadonlyMap<T['id'], T> {
  const map = new Map<T['id'], T>()
  for (const item of items) map.set(item.id, item)
  return map
}

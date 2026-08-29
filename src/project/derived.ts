import { npcKey } from '../insights/filters.ts'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { dialogueSearchText } from '../search/dialogue-search-text.ts'
import type { Dialogue, DialogueId } from './types.ts'

// Facts derived from the document, shared across the map screen, the quest board, the insights
// screen and the search palette instead of each rebuilding its own copy.
//
// Every derivation here caches on the **identity** of its own input array, never on `project` as
// a whole and never on value — the same discipline `src/map/zone-index.ts` applies when it keys
// on `(dialogues, zones, maps)` rather than on the document. A zone drag replaces `project.zones`
// and must not cost the dialogue-derived caches here a rebuild; a new dialogue replaces
// `project.dialogues` and must cost exactly the derivations that read it.

/**
 * A cache with one slot, keyed on the identity of the array `build` was run against — the pattern
 * `src/map/zone-index.ts:277-282` uses for its own candidates, generalised so each derivation
 * below does not write it out by hand.
 */
function identityCache<TInput, TOutput>(build: (input: TInput) => TOutput): (input: TInput) => TOutput {
  let cached: { input: TInput; output: TOutput } | null = null
  return (input: TInput): TOutput => {
    if (cached !== null && cached.input === input) return cached.output
    const output = build(input)
    cached = { input, output }
    return output
  }
}

/**
 * How many lines each NPC has, keyed by `npcKey` — one pass over `dialogues`, replacing the
 * search palette's old per-NPC scan. Map iteration order is insertion order, which is also the
 * first-appearance order `distinctNpcKeys` used to build with its own `Set` — so `[...keys()]`
 * on this is a drop-in replacement for it.
 */
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

/**
 * `dialogueSearchText`, lowercased once per dialogue and kept — not recomputed on every
 * keystroke of the search palette, the insights filter, or `QuestBoard`'s dialogue picker.
 * `dialogueSearchText` itself stays the single spelling of *what* a dialogue is found by; this
 * only caches calling it across the whole array.
 */
export const dialogueSearchTexts = identityCache(
  (dialogues: readonly Dialogue[]): ReadonlyMap<DialogueId, string> => {
    const texts = new Map<DialogueId, string>()
    for (const dialogue of dialogues) texts.set(dialogue.id, dialogueSearchText(dialogue))
    return texts
  },
)

/** `dialogueSearchTexts`, for one dialogue — the shape every filter predicate actually wants. */
export function searchTextOf(dialogue: Dialogue, dialogues: readonly Dialogue[]): string {
  return dialogueSearchTexts(dialogues).get(dialogue.id) ?? dialogueSearchText(dialogue)
}

/**
 * `indexQuestsByDialogue`, cached on `quests`' own identity — so the map screen and the quest
 * board share one build across a route change, exactly as `zone-index.ts` already does for the
 * zone index. `indexQuestsByDialogue` stays the single spelling of *how* the index is built.
 */
export const questIndexFor = identityCache(indexQuestsByDialogue)

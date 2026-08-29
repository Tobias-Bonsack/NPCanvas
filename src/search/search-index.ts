import { npcLabel } from '../insights/filters.ts'
import { zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { dialogueSearchTexts, npcLineCounts } from '../project/derived.ts'
import type { Dialogue, ProjectFile, Quest, Zone } from '../project/types.ts'

/** One hit, still carrying the record it came from — the palette reads what it needs to render
 *  and to navigate from the record itself, rather than a second projection of the same fields. */
export type SearchResult =
  | { kind: 'dialogue'; dialogue: Dialogue }
  | { kind: 'npc'; key: string; lineCount: number }
  | { kind: 'quest'; quest: Quest }
  | { kind: 'zone'; zone: Zone }

export type SearchOutcome = {
  results: readonly SearchResult[]
  /** How many more matched beyond the cap — `0` when nothing was cut. */
  hiddenCount: number
}

/** Past this many results the palette stops being scannable at a glance. */
export const SEARCH_RESULT_LIMIT = 30

const EMPTY_OUTCOME: SearchOutcome = { results: [], hiddenCount: 0 }

/**
 * Everything the palette can jump to, in one pass over the project: dialogues by NPC name and
 * what was said, NPCs by name, quests by name, zones by name. Grouped in that order — dialogues
 * first, since "that line the innkeeper said" is the case the palette exists for — and capped so
 * a broad query still renders instantly. No fuzzy matching and no cross-kind ranking: every group
 * uses the same substring predicate `dialogueSearchText` uses, and document order within a kind.
 *
 * An empty (or all-whitespace) query matches nothing: the palette is for finding a specific
 * thing, not for browsing the whole project.
 */
export function searchProject(project: ProjectFile, query: string): SearchOutcome {
  const needle = query.trim().toLowerCase()
  if (needle === '') return EMPTY_OUTCOME

  const searchTexts = dialogueSearchTexts(project.dialogues)
  const dialogues: SearchResult[] = project.dialogues
    .filter((dialogue) => (searchTexts.get(dialogue.id) ?? '').includes(needle))
    .map((dialogue) => ({ kind: 'dialogue', dialogue }))

  const lineCounts = npcLineCounts(project.dialogues)
  const npcs: SearchResult[] = [...lineCounts.keys()]
    .filter((key) => npcLabel(key).toLowerCase().includes(needle))
    .map((key) => ({ kind: 'npc', key, lineCount: lineCounts.get(key) ?? 0 }))

  const quests: SearchResult[] = project.quests
    .filter((quest) => questLabel(quest).toLowerCase().includes(needle))
    .map((quest) => ({ kind: 'quest', quest }))

  const zones: SearchResult[] = project.zones
    .filter((zone) => zoneLabel(zone).toLowerCase().includes(needle))
    .map((zone) => ({ kind: 'zone', zone }))

  const all = [...dialogues, ...npcs, ...quests, ...zones]
  return {
    results: all.slice(0, SEARCH_RESULT_LIMIT),
    hiddenCount: Math.max(0, all.length - SEARCH_RESULT_LIMIT),
  }
}

function questLabel(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}

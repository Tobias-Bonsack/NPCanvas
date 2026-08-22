import { npcKey, npcLabel } from '../insights/filters.ts'
import { zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import type { Dialogue, ProjectFile, Quest, Zone } from '../project/types.ts'
import { dialogueSearchText } from './dialogue-search-text.ts'

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

  const dialogues: SearchResult[] = project.dialogues
    .filter((dialogue) => dialogueSearchText(dialogue).includes(needle))
    .map((dialogue) => ({ kind: 'dialogue', dialogue }))

  const npcs: SearchResult[] = distinctNpcKeys(project.dialogues)
    .filter((key) => npcLabel(key).toLowerCase().includes(needle))
    .map((key) => ({ kind: 'npc', key, lineCount: lineCountOf(project.dialogues, key) }))

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

function distinctNpcKeys(dialogues: readonly Dialogue[]): string[] {
  const keys = new Set<string>()
  for (const dialogue of dialogues) keys.add(npcKey(dialogue))
  return [...keys]
}

function lineCountOf(dialogues: readonly Dialogue[], key: string): number {
  return dialogues.filter((dialogue) => npcKey(dialogue) === key).length
}

function questLabel(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}

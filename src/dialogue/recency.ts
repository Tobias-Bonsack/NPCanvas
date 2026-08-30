import { byTimeDesc, dialoguesByTimeDesc } from './dialogue-order.ts'
import type { Dialogue } from '../project/types.ts'

const RECENT_NPC_LIMIT = 5

// The most-recently-spoken NPCs lead the list, then everyone else alphabetically — while
// playing, the next line is usually one of the last few people talked to.
export function npcNamesIn(dialogues: readonly Dialogue[]): string[] {
  const byRecency = dialoguesByTimeDesc(dialogues)
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const dialogue of byRecency) {
    const trimmed = dialogue.npcName.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    ordered.push(trimmed)
  }
  const recent = ordered.slice(0, RECENT_NPC_LIMIT)
  const rest = ordered.slice(RECENT_NPC_LIMIT).sort((a, b) => a.localeCompare(b))
  return [...recent, ...rest]
}

// spokenAt is the only ordering a Dialogue or PendingCapture carries, so this generic form
// serves both.
export function previousRecordFor<T extends { id: string; spokenAt: string }>(
  items: readonly T[],
  excludeId: T['id'],
): T | null {
  return items.filter((candidate) => candidate.id !== excludeId).sort(byTimeDesc)[0] ?? null
}

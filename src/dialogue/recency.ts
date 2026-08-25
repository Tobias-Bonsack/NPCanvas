import type { Dialogue } from '../project/types.ts'

/** How many of the most-recently-spoken NPCs lead the list before it falls back to alphabetical. */
const RECENT_NPC_LIMIT = 5

/**
 * Every NPC name in the project, deduplicated and blanks dropped — the most recently spoken
 * `RECENT_NPC_LIMIT` first, in that order, then everyone else in locale order. While playing,
 * the next line is usually one of the last few people talked to; alphabetical order made every
 * one of them equally far from the top.
 *
 * Its own module, not `DialoguePanel.tsx`, because `PendingCaptureList.tsx`'s own `NpcNameInput`
 * shares this — and because a `.tsx` that exports anything but components breaks Fast Refresh.
 */
export function npcNamesIn(dialogues: readonly Dialogue[]): string[] {
  const byRecency = [...dialogues].sort((a, b) => b.spokenAt.localeCompare(a.spokenAt))
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

/**
 * The most recently spoken record other than `excludeId`, or `null` when there is no other one
 * — the "previous line" a freshly placed dialogue offers to copy, and the "previous capture" a
 * pending-capture row offers to copy (`PendingCaptureList.tsx`). `spokenAt` is the only ordering
 * either a `Dialogue` or a `PendingCapture` carries, so one sorting implementation serves both
 * rather than two.
 */
export function previousRecordFor<T extends { id: string; spokenAt: string }>(
  items: readonly T[],
  excludeId: T['id'],
): T | null {
  return (
    items
      .filter((candidate) => candidate.id !== excludeId)
      .sort((a, b) => b.spokenAt.localeCompare(a.spokenAt))[0] ?? null
  )
}

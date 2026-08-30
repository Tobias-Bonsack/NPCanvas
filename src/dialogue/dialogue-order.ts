import type { Dialogue, DialogueId } from '../project/types.ts'

// Dialogue and PendingCapture both qualify, so previousRecordFor (recency.ts) shares these.
type Timed = { spokenAt: string }

// ISO 8601 sorts lexicographically, so no Date is constructed per comparison.
export function byTimeAsc(a: Timed, b: Timed): number {
  return a.spokenAt.localeCompare(b.spokenAt)
}

// Not [...ascending].reverse() — that would also reverse the tie order a stable sort preserves.
export function byTimeDesc(a: Timed, b: Timed): number {
  return b.spokenAt.localeCompare(a.spokenAt)
}

// Cached on the array's identity, same pattern as indexDialoguesByZone — several readers ask
// the same question of the same array, so this builds it once per document change.
let cachedAsc: { dialogues: readonly Dialogue[]; ordered: readonly Dialogue[] } | null = null

export function dialoguesByTimeAsc(dialogues: readonly Dialogue[]): readonly Dialogue[] {
  if (cachedAsc !== null && cachedAsc.dialogues === dialogues) return cachedAsc.ordered
  const ordered = [...dialogues].sort(byTimeAsc)
  cachedAsc = { dialogues, ordered }
  return ordered
}

let cachedDesc: { dialogues: readonly Dialogue[]; ordered: readonly Dialogue[] } | null = null

export function dialoguesByTimeDesc(dialogues: readonly Dialogue[]): readonly Dialogue[] {
  if (cachedDesc !== null && cachedDesc.dialogues === dialogues) return cachedDesc.ordered
  const ordered = [...dialogues].sort(byTimeDesc)
  cachedDesc = { dialogues, ordered }
  return ordered
}

// Lets a subset (a quest's linked lines, a search result) be placed in the shared order by
// comparing two numbers instead of re-deriving it from spokenAt a second time.
let cachedRank: { dialogues: readonly Dialogue[]; rank: ReadonlyMap<DialogueId, number> } | null =
  null

function timeRank(dialogues: readonly Dialogue[]): ReadonlyMap<DialogueId, number> {
  if (cachedRank !== null && cachedRank.dialogues === dialogues) return cachedRank.rank
  const rank = new Map<DialogueId, number>(dialoguesByTimeAsc(dialogues).map((d, i) => [d.id, i]))
  cachedRank = { dialogues, rank }
  return rank
}

export function subsetByTimeAsc<T extends Dialogue>(
  subset: readonly T[],
  dialogues: readonly Dialogue[],
): T[] {
  const rank = timeRank(dialogues)
  return [...subset].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
}

export function subsetByTimeDesc<T extends Dialogue>(
  subset: readonly T[],
  dialogues: readonly Dialogue[],
): T[] {
  const rank = timeRank(dialogues)
  return [...subset].sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0))
}

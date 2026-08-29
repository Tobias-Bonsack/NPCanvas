import type { Dialogue, DialogueId } from '../project/types.ts'

/**
 * A record with the only field a chronological order ever needs. `Dialogue` and `PendingCapture`
 * both qualify, which is why `previousRecordFor` (`recency.ts`) can share these across both.
 */
type Timed = { spokenAt: string }

/**
 * Earliest first. ISO 8601 sorts lexicographically, so no `Date` is constructed per comparison.
 * Declared once so the direction of "chronological" is a single decision, not one per call site —
 * a reversed comparator at one of the several call sites that used to spell this out by hand was
 * a silent bug rather than a type error.
 */
export function byTimeAsc(a: Timed, b: Timed): number {
  return a.spokenAt.localeCompare(b.spokenAt)
}

/**
 * Latest first — the reverse comparison, not `[...ascending].reverse()`: reversing an
 * already-stable sort would also reverse the tie order a fresh stable sort preserves.
 */
export function byTimeDesc(a: Timed, b: Timed): number {
  return b.spokenAt.localeCompare(a.spokenAt)
}

/**
 * `dialogues` sorted chronologically ascending, cached on the array's **identity** — same pattern
 * as `indexDialoguesByZone` (`src/map/zone-index.ts`). The quest board, the NPC dossier, the
 * dialogue panel's merge list and the insights timeline all ask the same question of the same
 * array, and each used to re-sort it once per render; this builds it once per document change and
 * every reader shares the result.
 *
 * Identity, never value: the reducer returns the same `dialogues` reference for an action that
 * left it untouched (a zone edit, for instance) and a new one for any action that changed it (an
 * added dialogue among them), which is exactly the invalidation this cache wants.
 */
let cachedAsc: { dialogues: readonly Dialogue[]; ordered: readonly Dialogue[] } | null = null

export function dialoguesByTimeAsc(dialogues: readonly Dialogue[]): readonly Dialogue[] {
  if (cachedAsc !== null && cachedAsc.dialogues === dialogues) return cachedAsc.ordered
  const ordered = [...dialogues].sort(byTimeAsc)
  cachedAsc = { dialogues, ordered }
  return ordered
}

/** `dialogues` sorted chronologically descending, cached the same way as `dialoguesByTimeAsc`. */
let cachedDesc: { dialogues: readonly Dialogue[]; ordered: readonly Dialogue[] } | null = null

export function dialoguesByTimeDesc(dialogues: readonly Dialogue[]): readonly Dialogue[] {
  if (cachedDesc !== null && cachedDesc.dialogues === dialogues) return cachedDesc.ordered
  const ordered = [...dialogues].sort(byTimeDesc)
  cachedDesc = { dialogues, ordered }
  return ordered
}

/**
 * Each dialogue's position in the shared ascending order, built alongside it. A subset of
 * `dialogues` — a quest's linked lines, one NPC's lines, a search result — can then be placed in
 * that same order by comparing two numbers instead of re-deriving the order from `spokenAt` a
 * second time, which is what `subsetByTimeAsc`/`subsetByTimeDesc` below do.
 */
let cachedRank: { dialogues: readonly Dialogue[]; rank: ReadonlyMap<DialogueId, number> } | null =
  null

function timeRank(dialogues: readonly Dialogue[]): ReadonlyMap<DialogueId, number> {
  if (cachedRank !== null && cachedRank.dialogues === dialogues) return cachedRank.rank
  const rank = new Map<DialogueId, number>(dialoguesByTimeAsc(dialogues).map((d, i) => [d.id, i]))
  cachedRank = { dialogues, rank }
  return rank
}

/**
 * `subset` — every element of which must also be in `dialogues` — placed in the same ascending
 * order `dialoguesByTimeAsc(dialogues)` already settled, rather than re-sorting the subset from
 * scratch against `spokenAt` a second time.
 */
export function subsetByTimeAsc<T extends Dialogue>(
  subset: readonly T[],
  dialogues: readonly Dialogue[],
): T[] {
  const rank = timeRank(dialogues)
  return [...subset].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
}

/** `subset` in descending order, via the same shared rank as `subsetByTimeAsc`. */
export function subsetByTimeDesc<T extends Dialogue>(
  subset: readonly T[],
  dialogues: readonly Dialogue[],
): T[] {
  const rank = timeRank(dialogues)
  return [...subset].sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0))
}

import { relevanceColor } from '../dialogue/relevance.ts'
import type { Dialogue, RelevanceTag, RelevanceTagId } from '../project/types.ts'

/**
 * One stacked segment: a relevance tag, or the absence of all of them. "Untagged" is a real
 * answer — the canvas legend names it too — so it gets a segment rather than shrinking the bar.
 *
 * Shared by every insights chart, so a colour, a texture or a word can never mean one thing in
 * the breakdown and another on the timeline. The drawing lives in `SegmentLegend.tsx`; this file
 * is the vocabulary — now a function of the project's own `relevanceTags` rather than a
 * compile-time constant, so a chart cannot describe a vocabulary the project has moved past.
 */
export type SegmentKey = RelevanceTagId | 'untagged'

export const UNTAGGED_SEGMENT: SegmentKey = 'untagged'

/** Every segment a chart draws, tags first in the project's own order, untagged last. */
export function segmentKeys(tags: readonly RelevanceTag[]): SegmentKey[] {
  return [...tags.map((tag) => tag.id), UNTAGGED_SEGMENT]
}

export function segmentLabel(tags: readonly RelevanceTag[]): ReadonlyMap<SegmentKey, string> {
  const labels = new Map<SegmentKey, string>(tags.map((tag) => [tag.id, tag.name]))
  labels.set(UNTAGGED_SEGMENT, 'Untagged')
  return labels
}

/**
 * Fixed colour for the untagged segment; every tagged one takes the tag's own hue, so a segment
 * means the same thing on the canvas and in a chart. Mid-lightness, so the near-black count
 * labels stay legible on it in either colour scheme.
 */
const UNTAGGED_COLOR = 'hsl(220 8% 62%)'

export function segmentColor(tags: readonly RelevanceTag[]): ReadonlyMap<SegmentKey, string> {
  const colors = new Map<SegmentKey, string>(tags.map((tag) => [tag.id, relevanceColor(tag.hue)]))
  colors.set(UNTAGGED_SEGMENT, UNTAGGED_COLOR)
  return colors
}

/**
 * A group of dialogues counted two ways: how many lines it holds, and how those lines break
 * down by tag. The two differ on purpose — a line carrying two tags lands in both segments, so
 * the segments sum higher than the line count, and every chart says so in its own caption.
 *
 * `counts` is a `Map`, not a `Record`: a branded `RelevanceTagId` as a `Record` key would be an
 * index signature that hands back `number` for a key that is not there.
 */
export type Tally = { dialogues: number; counts: Map<SegmentKey, number> }

export function emptyTally(tags: readonly RelevanceTag[]): Tally {
  const counts = new Map<SegmentKey, number>(tags.map((tag) => [tag.id, 0]))
  counts.set(UNTAGGED_SEGMENT, 0)
  return { dialogues: 0, counts }
}

export function tally(bucket: Tally, dialogue: Dialogue): void {
  bucket.dialogues += 1
  if (dialogue.relevance.length === 0) {
    bucket.counts.set(UNTAGGED_SEGMENT, (bucket.counts.get(UNTAGGED_SEGMENT) ?? 0) + 1)
    return
  }
  for (const tagId of dialogue.relevance) {
    bucket.counts.set(tagId, (bucket.counts.get(tagId) ?? 0) + 1)
  }
}

export function tallyOf(dialogues: readonly Dialogue[], tags: readonly RelevanceTag[]): Tally {
  const bucket = emptyTally(tags)
  for (const dialogue of dialogues) tally(bucket, dialogue)
  return bucket
}

/** The stacked extent of a tally: tag occurrences, not lines. */
export function totalOf(counts: ReadonlyMap<SegmentKey, number>): number {
  let sum = 0
  for (const count of counts.values()) sum += count
  return sum
}

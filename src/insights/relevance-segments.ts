import { relevanceColor } from '../dialogue/relevance.ts'
import type { Dialogue, RelevanceTag, RelevanceTagId } from '../project/types.ts'

// "Untagged" is a real segment, not a shrunk bar — shared vocabulary across every insights
// chart, built from the project's own relevanceTags so a chart can't describe a stale vocabulary.
export type SegmentKey = RelevanceTagId | 'untagged'

const UNTAGGED_SEGMENT: SegmentKey = 'untagged'

export function segmentKeys(tags: readonly RelevanceTag[]): SegmentKey[] {
  return [...tags.map((tag) => tag.id), UNTAGGED_SEGMENT]
}

export function segmentLabel(tags: readonly RelevanceTag[]): ReadonlyMap<SegmentKey, string> {
  const labels = new Map<SegmentKey, string>(tags.map((tag) => [tag.id, tag.name]))
  labels.set(UNTAGGED_SEGMENT, 'Untagged')
  return labels
}

// Mid-lightness so the near-black count labels stay legible on it in either colour scheme.
const UNTAGGED_COLOR = 'hsl(220 8% 62%)'

export function segmentColor(tags: readonly RelevanceTag[]): ReadonlyMap<SegmentKey, string> {
  const colors = new Map<SegmentKey, string>(tags.map((tag) => [tag.id, relevanceColor(tag.hue)]))
  colors.set(UNTAGGED_SEGMENT, UNTAGGED_COLOR)
  return colors
}

// A line carrying two tags lands in both segments, so counts can sum higher than dialogues.
// Map, not Record — a branded RelevanceTagId as a Record key would fabricate a `number` for a
// missing key.
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

export function totalOf(counts: ReadonlyMap<SegmentKey, number>): number {
  let sum = 0
  for (const count of counts.values()) sum += count
  return sum
}

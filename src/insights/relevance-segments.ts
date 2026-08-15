import { RELEVANCE_STYLE, relevanceColor } from '../dialogue/relevance.ts'
import type { Dialogue, RelevanceTag } from '../project/types.ts'
import { RELEVANCE_TAGS } from '../project/types.ts'

/**
 * One stacked segment: a relevance tag, or the absence of all of them. "Untagged" is a real
 * answer — the canvas legend names it too — so it gets a segment rather than shrinking the bar.
 *
 * Shared by every insights chart, so a colour, a texture or a word can never mean one thing in
 * the breakdown and another on the timeline. The drawing lives in `SegmentLegend.tsx`; this file
 * is the vocabulary.
 */
export type SegmentKey = RelevanceTag | 'untagged'

export const SEGMENT_KEYS: readonly SegmentKey[] = [...RELEVANCE_TAGS, 'untagged']

export const SEGMENT_LABEL: Record<SegmentKey, string> = {
  'out-of-world': RELEVANCE_STYLE['out-of-world'].label,
  worldbuilding: RELEVANCE_STYLE.worldbuilding.label,
  peoplebuilding: RELEVANCE_STYLE.peoplebuilding.label,
  other: RELEVANCE_STYLE.other.label,
  untagged: 'Untagged',
}

/**
 * Fixed colours rather than theme tokens: these are the hues the pins already fly, and a
 * segment has to mean the same thing on the canvas and in a chart. All five are mid-lightness,
 * so the near-black count labels stay legible on every one of them in either colour scheme.
 */
export const SEGMENT_COLOR: Record<SegmentKey, string> = {
  'out-of-world': relevanceColor('out-of-world'),
  worldbuilding: relevanceColor('worldbuilding'),
  peoplebuilding: relevanceColor('peoplebuilding'),
  other: relevanceColor('other'),
  untagged: 'hsl(220 8% 62%)',
}

/**
 * A group of dialogues counted two ways: how many lines it holds, and how those lines break
 * down by tag. The two differ on purpose — a line carrying two tags lands in both segments, so
 * the segments sum higher than the line count, and every chart says so in its own caption.
 */
export type Tally = { dialogues: number; counts: Record<SegmentKey, number> }

export function emptyTally(): Tally {
  return {
    dialogues: 0,
    counts: { 'out-of-world': 0, worldbuilding: 0, peoplebuilding: 0, other: 0, untagged: 0 },
  }
}

export function tally(bucket: Tally, dialogue: Dialogue): void {
  bucket.dialogues += 1
  if (dialogue.relevance.length === 0) {
    bucket.counts.untagged += 1
    return
  }
  for (const tag of dialogue.relevance) bucket.counts[tag] += 1
}

export function tallyOf(dialogues: readonly Dialogue[]): Tally {
  const bucket = emptyTally()
  for (const dialogue of dialogues) tally(bucket, dialogue)
  return bucket
}

/** The stacked extent of a tally: tag occurrences, not lines. */
export function totalOf(counts: Record<SegmentKey, number>): number {
  return SEGMENT_KEYS.reduce((sum, segment) => sum + counts[segment], 0)
}

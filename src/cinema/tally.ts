import { npcKey } from '../insights/filters.ts'
import { emptyTally, tally } from '../insights/relevance-segments.ts'
import type { SegmentKey, Tally } from '../insights/relevance-segments.ts'
import { identityCache } from '../project/derived.ts'
import type { RelevanceTag, ZoneId } from '../project/types.ts'
import type { Reel } from './reel.ts'

/** What the journey has accumulated through one moment — see CLAUDE.md § "Cinema" and #162. */
export type JourneySoFar = {
  moments: number
  frames: number
  segments: Tally
  /** Moment index where each segment was first seen; absent for a tag never applied. */
  firstSeen: ReadonlyMap<SegmentKey, number>
  zonesVisited: ReadonlySet<ZoneId>
  npcsMet: ReadonlySet<string>
  referencesMade: number
  /** Summed within sittings only — play time, not wall-clock. */
  playedMs: number
}

function journeyTallyUncached(reel: Reel, tags: readonly RelevanceTag[]): readonly JourneySoFar[] {
  const results: JourneySoFar[] = []
  const segments = emptyTally(tags)
  const firstSeen = new Map<SegmentKey, number>()
  const zonesVisited = new Set<ZoneId>()
  const npcsMet = new Set<string>()
  let frames = 0
  let referencesMade = 0
  let playedMs = 0
  let previousSessionIndex: number | null = null

  for (const moment of reel.moments) {
    const { dialogue } = moment
    tally(segments, dialogue)

    const segmentsHere: readonly SegmentKey[] = dialogue.relevance.length === 0 ? ['untagged'] : dialogue.relevance
    for (const segment of segmentsHere) {
      if (!firstSeen.has(segment)) firstSeen.set(segment, moment.index)
    }

    if (moment.zoneId !== null) zonesVisited.add(moment.zoneId)
    npcsMet.add(npcKey(dialogue))
    referencesMade += dialogue.references.length
    frames += dialogue.media.length
    if (previousSessionIndex === moment.sessionIndex) playedMs += moment.gapMsBefore
    previousSessionIndex = moment.sessionIndex

    // Each snapshot copies its own Map/Set — the prefix scan mutates shared accumulators above,
    // so a later index must never be visible through an earlier entry's collections.
    results.push({
      moments: moment.index + 1,
      frames,
      segments: { dialogues: segments.dialogues, counts: new Map(segments.counts) },
      firstSeen: new Map(firstSeen),
      zonesVisited: new Set(zonesVisited),
      npcsMet: new Set(npcsMet),
      referencesMade,
      playedMs,
    })
  }

  return results
}

// Two identityCache layers, not one keyed on a composite object — a fresh tuple each call would
// never hit the cache. The reel layer holds one tags-keyed cache alive as long as the reel itself
// hasn't changed identity, matching CLAUDE.md § "Store scope"'s identity-only caching discipline.
const journeyTallyByReel = identityCache((reel: Reel) => identityCache((tags: readonly RelevanceTag[]) => journeyTallyUncached(reel, tags)))

export function journeyTally(reel: Reel, tags: readonly RelevanceTag[]): readonly JourneySoFar[] {
  return journeyTallyByReel(reel)(tags)
}

export function journeyAt(tallies: readonly JourneySoFar[], index: number): JourneySoFar | undefined {
  return tallies[Math.min(Math.max(index, 0), tallies.length - 1)]
}

import { describe, expect, it } from 'vitest'
import { totalOf } from '../insights/relevance-segments.ts'
import { asDialogueId, asMapId, asRelevanceTagId, asZoneId } from '../project/ids.ts'
import type { Dialogue, RelevanceTag } from '../project/types.ts'
import type { Moment, Reel } from './reel.ts'
import { journeyAt, journeyTally } from './tally.ts'

const UNUSED_MAP = asMapId('unused-map')
const WORLD = asRelevanceTagId('world')
const HINT = asRelevanceTagId('hint')
const TAGS: RelevanceTag[] = [
  { id: WORLD, name: 'World', hue: 200 },
  { id: HINT, name: 'Hint', hue: 30 },
]

function dialogueOf(id: string, overrides: Partial<Dialogue> = {}): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: UNUSED_MAP,
    npcName: 'Mara',
    position: { x: 0, y: 0 },
    text: '',
    media: [],
    relevance: [],
    references: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
    ...overrides,
  }
}

type MomentSpec = {
  id: string
  sessionIndex?: number
  gapMsBefore?: number
  zoneId?: string | null
  npcName?: string
  relevance?: string[]
  references?: string[]
  media?: number
}

function reelOf(specs: MomentSpec[]): Reel {
  const moments: Moment[] = specs.map((spec, index) => ({
    dialogue: dialogueOf(spec.id, {
      npcName: spec.npcName ?? 'Mara',
      relevance: (spec.relevance ?? []).map(asRelevanceTagId),
      references: (spec.references ?? []).map(asDialogueId),
      media: Array.from({ length: spec.media ?? 0 }, () => ({})) as Dialogue['media'],
    }),
    index,
    sessionIndex: spec.sessionIndex ?? 0,
    gapMsBefore: spec.gapMsBefore ?? 0,
    zoneId: spec.zoneId === undefined || spec.zoneId === null ? null : asZoneId(spec.zoneId),
    dwellMs: 1500,
  }))
  return { moments, sessions: [] }
}

describe('journeyTally', () => {
  it('never decreases moments, frames or any segment count across the reel', () => {
    const reel = reelOf([
      { id: 'a', relevance: [WORLD], media: 1 },
      { id: 'b', relevance: [] },
      { id: 'c', relevance: [HINT], media: 2 },
    ])
    const tallies = journeyTally(reel, TAGS)
    for (let i = 1; i < tallies.length; i++) {
      expect(tallies[i].moments).toBeGreaterThanOrEqual(tallies[i - 1].moments)
      expect(tallies[i].frames).toBeGreaterThanOrEqual(tallies[i - 1].frames)
      for (const key of tallies[i].segments.counts.keys()) {
        const before = tallies[i - 1].segments.counts.get(key) ?? 0
        const after = tallies[i].segments.counts.get(key) ?? 0
        expect(after).toBeGreaterThanOrEqual(before)
      }
    }
  })

  it('returns identical values scrubbing forward then back', () => {
    const reel = reelOf([
      { id: 'a', relevance: [WORLD] },
      { id: 'b', relevance: [HINT] },
      { id: 'c', relevance: [] },
    ])
    const tallies = journeyTally(reel, TAGS)
    const before = journeyAt(tallies, 1)
    journeyAt(tallies, 2)
    const after = journeyAt(tallies, 1)
    expect(after).toEqual(before)
  })

  it('counts a line with two tags in both segments, so the total can exceed the moment count', () => {
    const reel = reelOf([{ id: 'a', relevance: [WORLD, HINT] }])
    const tallies = journeyTally(reel, TAGS)
    const at = journeyAt(tallies, 0)!
    expect(at.moments).toBe(1)
    expect(totalOf(at.segments.counts)).toBe(2)
  })

  it('lands an untagged line in the untagged segment', () => {
    const reel = reelOf([{ id: 'a', relevance: [] }])
    const tallies = journeyTally(reel, TAGS)
    expect(journeyAt(tallies, 0)!.segments.counts.get('untagged')).toBe(1)
  })

  it('leaves firstSeen absent for a tag the project defines but never applies', () => {
    const reel = reelOf([{ id: 'a', relevance: [WORLD] }])
    const tallies = journeyTally(reel, TAGS)
    const at = journeyAt(tallies, 0)!
    expect(at.firstSeen.has(WORLD)).toBe(true)
    expect(at.firstSeen.has(HINT)).toBe(false)
  })

  it('records firstSeen at the moment index of the first application, not later', () => {
    const reel = reelOf([{ id: 'a', relevance: [] }, { id: 'b', relevance: [HINT] }, { id: 'c', relevance: [HINT] }])
    const tallies = journeyTally(reel, TAGS)
    expect(journeyAt(tallies, 2)!.firstSeen.get(HINT)).toBe(1)
  })

  it('ignores a gap that opens a new session when summing playedMs', () => {
    const reel = reelOf([
      { id: 'a', sessionIndex: 0, gapMsBefore: 0 },
      { id: 'b', sessionIndex: 0, gapMsBefore: 60_000 },
      { id: 'c', sessionIndex: 1, gapMsBefore: 999_000_000 },
      { id: 'd', sessionIndex: 1, gapMsBefore: 30_000 },
    ])
    const tallies = journeyTally(reel, TAGS)
    expect(journeyAt(tallies, 3)!.playedMs).toBe(60_000 + 30_000)
  })

  it('counts zones visited and NPCs met by npcKey, deduplicated', () => {
    const reel = reelOf([
      { id: 'a', zoneId: 'town', npcName: 'Mara' },
      { id: 'b', zoneId: 'town', npcName: ' Mara ' },
      { id: 'c', zoneId: 'shop', npcName: 'Oak' },
    ])
    const tallies = journeyTally(reel, TAGS)
    const at = journeyAt(tallies, 2)!
    expect(at.zonesVisited.size).toBe(2)
    expect(at.npcsMet).toEqual(new Set(['Mara', 'Oak']))
  })
})

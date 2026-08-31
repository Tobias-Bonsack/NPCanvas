import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asMediaId, asZoneId } from '../project/ids.ts'
import type { Dialogue, DialogueMedia, MapId, ZoneId } from '../project/types.ts'
import type { Moment, Reel, Session } from './reel.ts'
import { MAX_SLOT_HEIGHT, MIN_SLOT_HEIGHT, bandLayout } from './band-layout.ts'

const UNUSED_MAP: MapId = asMapId('unused-map')

function dialogueOf(id: string, media: DialogueMedia[] = []): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: UNUSED_MAP,
    npcName: 'Mara',
    position: { x: 0, y: 0 },
    text: '',
    media,
    relevance: [],
    references: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
  }
}

function frame(id: string): DialogueMedia {
  return {
    id: asMediaId(id),
    kind: 'image',
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 10 },
    width: 10,
    height: 10,
  }
}

/** One moment per id, in order; `zoneId` and `gapMsBefore` default to values tests overwrite. */
function momentsOf(ids: readonly (readonly [string, ZoneId | null])[]): Moment[] {
  return ids.map(([id, zoneId], index) => ({
    dialogue: dialogueOf(id),
    index,
    sessionIndex: 0,
    gapMsBefore: 0,
    zoneId,
    dwellMs: 1500,
  }))
}

function reelWithSessions(moments: Moment[], sessionBreaks: number[]): Reel {
  const sessions: Session[] = []
  let start = 0
  for (const breakAt of [...sessionBreaks, moments.length]) {
    const slice = moments.slice(start, breakAt)
    sessions.push({
      index: sessions.length,
      firstMoment: slice[0],
      lastMoment: slice[slice.length - 1],
      gapMsBefore: sessions.length === 0 ? 0 : slice[0].gapMsBefore,
    })
    start = breakAt
  }
  return { moments, sessions }
}

describe('bandLayout', () => {
  it('returns empty arrays for an empty reel rather than throwing', () => {
    const layout = bandLayout({ moments: [], sessions: [] }, 300)
    expect(layout).toEqual({ slots: [], notches: [], zoneRuns: [] })
  })

  it('gives a single-moment reel one slot spanning the full width', () => {
    const moments = momentsOf([['a', null]])
    const reel = reelWithSessions(moments, [])
    const layout = bandLayout(reel, 300)
    expect(layout.slots).toHaveLength(1)
    expect(layout.slots[0].x).toBe(0)
    expect(layout.slots[0].width).toBe(300)
  })

  it('partitions the width exactly for any moment count, with the last slot ending at width', () => {
    for (const count of [1, 2, 3, 7, 13, 200]) {
      const moments = momentsOf(Array.from({ length: count }, (_, i) => [`d${i}`, null] as const))
      const reel = reelWithSessions(moments, [])
      const layout = bandLayout(reel, 731)

      let cursor = 0
      for (const slot of layout.slots) {
        expect(slot.x).toBeCloseTo(cursor)
        cursor += slot.width
      }
      expect(cursor).toBe(731)
      expect(layout.slots[layout.slots.length - 1].x + layout.slots[layout.slots.length - 1].width).toBe(731)
    }
  })

  it('breaks a zone run only where the zone changes, and gives a null zone its own runs', () => {
    const zoneA = asZoneId('a')
    const zoneB = asZoneId('b')
    const moments = momentsOf([
      ['d0', zoneA],
      ['d1', zoneA],
      ['d2', null],
      ['d3', zoneB],
      ['d4', zoneB],
      ['d5', zoneA],
    ])
    const reel = reelWithSessions(moments, [])
    const layout = bandLayout(reel, 600)

    expect(layout.zoneRuns.map((run) => run.zoneId)).toEqual([zoneA, null, zoneB, zoneA])

    let cursor = 0
    for (const run of layout.zoneRuns) {
      expect(run.x).toBeCloseTo(cursor)
      cursor += run.width
    }
    expect(cursor).toBe(600)
  })

  it('places a notch only at session boundaries, never inside a session', () => {
    const moments = momentsOf(Array.from({ length: 6 }, (_, i) => [`d${i}`, null] as const))
    moments[2].gapMsBefore = 3 * 60 * 60_000
    moments[4].gapMsBefore = 26 * 60 * 60_000
    const reel = reelWithSessions(moments, [2, 4])

    const layout = bandLayout(reel, 600)
    expect(layout.notches).toHaveLength(2)
    expect(layout.notches[0].x).toBeCloseTo(200)
    expect(layout.notches[0].gapMs).toBe(3 * 60 * 60_000)
    expect(layout.notches[1].x).toBeCloseTo(400)
    expect(layout.notches[1].gapMs).toBe(26 * 60 * 60_000)
  })

  it('produces no notches for a reel that never crosses a session gap', () => {
    const moments = momentsOf(Array.from({ length: 4 }, (_, i) => [`d${i}`, null] as const))
    const reel = reelWithSessions(moments, [])
    expect(bandLayout(reel, 400).notches).toEqual([])
  })

  it('clamps slot height at the minimum for a line with no frames', () => {
    const moments = [{ ...momentsOf([['d0', null]])[0], dialogue: dialogueOf('d0', []) }]
    const reel = reelWithSessions(moments, [])
    expect(bandLayout(reel, 300).slots[0].height).toBe(MIN_SLOT_HEIGHT)
  })

  it('clamps slot height at the maximum for a line with an outsized frame count', () => {
    const frames = Array.from({ length: 5000 }, (_, i) => frame(`f${i}`))
    const moments = [{ ...momentsOf([['d0', null]])[0], dialogue: dialogueOf('d0', frames) }]
    const reel = reelWithSessions(moments, [])
    expect(bandLayout(reel, 300).slots[0].height).toBe(MAX_SLOT_HEIGHT)
  })

  it('gives a one-frame line a height above the minimum clamp — a visible tick, not nothing', () => {
    const moments = [{ ...momentsOf([['d0', null]])[0], dialogue: dialogueOf('d0', [frame('f0')]) }]
    const reel = reelWithSessions(moments, [])
    expect(bandLayout(reel, 300).slots[0].height).toBeGreaterThan(MIN_SLOT_HEIGHT)
  })
})

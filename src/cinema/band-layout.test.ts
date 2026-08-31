import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asMediaId } from '../project/ids.ts'
import type { Dialogue, DialogueMedia, MapId, ZoneId } from '../project/types.ts'
import type { Moment } from './reel.ts'
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

/** One moment per id, in order; `zoneId` defaults to values tests overwrite. */
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

describe('bandLayout', () => {
  it('returns no slots for no walked moments', () => {
    expect(bandLayout([], 300)).toEqual([])
  })

  it('gives a single walked moment one slot spanning the full width', () => {
    const walked = momentsOf([['a', null]])
    const slots = bandLayout(walked, 300)
    expect(slots).toHaveLength(1)
    expect(slots[0].x).toBe(0)
    expect(slots[0].width).toBe(300)
  })

  it('partitions the width exactly for any walked count, with the last slot ending at width', () => {
    for (const count of [1, 2, 3, 7, 13, 200]) {
      const walked = momentsOf(Array.from({ length: count }, (_, i) => [`d${i}`, null] as const))
      const slots = bandLayout(walked, 731)

      let cursor = 0
      for (const slot of slots) {
        expect(slot.x).toBeCloseTo(cursor)
        cursor += slot.width
      }
      expect(cursor).toBe(731)
      expect(slots[slots.length - 1].x + slots[slots.length - 1].width).toBe(731)
    }
  })

  it('clamps slot height at the minimum for a line with no frames', () => {
    const walked = [{ ...momentsOf([['d0', null]])[0], dialogue: dialogueOf('d0', []) }]
    expect(bandLayout(walked, 300)[0].height).toBe(MIN_SLOT_HEIGHT)
  })

  it('clamps slot height at the maximum for a line with an outsized frame count', () => {
    const frames = Array.from({ length: 5000 }, (_, i) => frame(`f${i}`))
    const walked = [{ ...momentsOf([['d0', null]])[0], dialogue: dialogueOf('d0', frames) }]
    expect(bandLayout(walked, 300)[0].height).toBe(MAX_SLOT_HEIGHT)
  })

  it('gives a one-frame line a height above the minimum clamp — a visible tick, not nothing', () => {
    const walked = [{ ...momentsOf([['d0', null]])[0], dialogue: dialogueOf('d0', [frame('f0')]) }]
    expect(bandLayout(walked, 300)[0].height).toBeGreaterThan(MIN_SLOT_HEIGHT)
  })
})

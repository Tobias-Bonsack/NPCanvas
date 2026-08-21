import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asZoneId } from '../project/ids.ts'
import type { Dialogue, MapId, Point, Zone } from '../project/types.ts'
import type { Rect } from './geometry.ts'
import { rectToPolygon, translatePolygon } from './geometry.ts'
import {
  countDialoguesByZone,
  dialoguesInZone,
  indexDialoguesByZone,
  reindexMovedZone,
} from './zone-index.ts'

const HARBOUR = asMapId('harbour')
const CAVES = asMapId('caves')

function zone(id: string, mapId: MapId, rect: Rect): Zone {
  return { id: asZoneId(id), mapId, name: id, polygon: rectToPolygon(rect), hue: 200 }
}

function dialogue(id: string, mapId: MapId, position: Point): Dialogue {
  return {
    id: asDialogueId(id),
    mapId,
    npcName: id,
    position,
    text: '',
    media: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
    relevance: [],
  }
}

const TOWN = zone('town', HARBOUR, { x: 0, y: 0, width: 100, height: 100 })
const SHOP = zone('shop', HARBOUR, { x: 10, y: 10, width: 20, height: 20 })

describe('indexDialoguesByZone', () => {
  it('orders overlapping zones smallest-area-first, whatever order they are given in', () => {
    const inShop = dialogue('d1', HARBOUR, { x: 20, y: 20 })
    expect(indexDialoguesByZone([inShop], [TOWN, SHOP]).get(inShop.id)).toEqual([
      SHOP.id,
      TOWN.id,
    ])
    expect(indexDialoguesByZone([inShop], [SHOP, TOWN]).get(inShop.id)).toEqual([
      SHOP.id,
      TOWN.id,
    ])
  })

  it('gives a dialogue in no zone an empty list rather than no entry', () => {
    const outside = dialogue('d1', HARBOUR, { x: 500, y: 500 })
    const index = indexDialoguesByZone([outside], [TOWN, SHOP])
    expect(index.has(outside.id)).toBe(true)
    expect(index.get(outside.id)).toEqual([])
  })

  it('never matches a zone on another map, however the coordinates line up', () => {
    // The same map-local point, on a map the zones do not belong to.
    const elsewhere = dialogue('d1', CAVES, { x: 20, y: 20 })
    expect(indexDialoguesByZone([elsewhere], [TOWN, SHOP]).get(elsewhere.id)).toEqual([])
  })

  it('classifies a pin exactly on a zone edge as inside, consistently on every edge', () => {
    const onEdge = [
      dialogue('top', HARBOUR, { x: 20, y: 10 }),
      dialogue('right', HARBOUR, { x: 30, y: 20 }),
      dialogue('bottom', HARBOUR, { x: 20, y: 30 }),
      dialogue('left', HARBOUR, { x: 10, y: 20 }),
      dialogue('corner', HARBOUR, { x: 10, y: 10 }),
    ]
    const index = indexDialoguesByZone(onEdge, [TOWN, SHOP])
    for (const each of onEdge) {
      expect(index.get(each.id)).toEqual([SHOP.id, TOWN.id])
    }
  })

  it('keeps every dialogue when there are no zones at all', () => {
    const dialogues = [dialogue('d1', HARBOUR, { x: 1, y: 1 })]
    expect([...indexDialoguesByZone(dialogues, []).values()]).toEqual([[]])
  })

  it('reclassifies after a zone moves, with the dialogue untouched', () => {
    const pin = dialogue('d1', HARBOUR, { x: 20, y: 20 })
    const moved: Zone = { ...SHOP, polygon: rectToPolygon({ x: 60, y: 60, width: 20, height: 20 }) }
    expect(indexDialoguesByZone([pin], [TOWN, moved]).get(pin.id)).toEqual([TOWN.id])
  })
})

/**
 * The incremental path exists only to be indistinguishable from the definition it replaces, so
 * every case here compares it against a full build of the same input rather than against a
 * hand-written expectation.
 */
describe('reindexMovedZone', () => {
  const CAVE = zone('cave', CAVES, { x: 0, y: 0, width: 100, height: 100 })
  const ZONES = [TOWN, SHOP, CAVE]
  const DIALOGUES = [
    dialogue('in-shop', HARBOUR, { x: 20, y: 20 }),
    dialogue('in-town', HARBOUR, { x: 90, y: 90 }),
    dialogue('outside', HARBOUR, { x: 500, y: 500 }),
    dialogue('in-cave', CAVES, { x: 50, y: 50 }),
  ]

  function shopAt(by: Point): Zone[] {
    return ZONES.map((each) =>
      each.id === SHOP.id ? { ...SHOP, polygon: translatePolygon(SHOP.polygon, by) } : each,
    )
  }

  it('agrees with a full rebuild wherever the zone is dragged to', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES)
    const offsets: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 70, y: 70 },
      { x: -40, y: -40 },
      { x: 480, y: 480 },
      { x: 9000, y: 9000 },
    ]
    for (const by of offsets) {
      const drawn = shopAt(by)
      expect([...reindexMovedZone(previous, DIALOGUES, drawn, SHOP.id)]).toEqual([
        ...indexDialoguesByZone(DIALOGUES, drawn),
      ])
    }
  })

  it('re-inserts the zone where its area puts it, not wherever it left from', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES)
    // Out of the pin, then back onto it: the small zone has to come first again.
    const away = reindexMovedZone(previous, DIALOGUES, shopAt({ x: 60, y: 60 }), SHOP.id)
    expect(away.get(DIALOGUES[0].id)).toEqual([TOWN.id])
    const back = reindexMovedZone(away, DIALOGUES, shopAt({ x: 0, y: 0 }), SHOP.id)
    expect(back.get(DIALOGUES[0].id)).toEqual([SHOP.id, TOWN.id])
  })

  it('returns the previous index itself when the move changed no membership', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES)
    // A pixel of travel, with every pin far from the edge it would cross.
    expect(reindexMovedZone(previous, DIALOGUES, shopAt({ x: 1, y: 1 }), SHOP.id)).toBe(previous)
  })

  it('leaves the entries of dialogues on other maps untouched, by reference', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES)
    const next = reindexMovedZone(previous, DIALOGUES, shopAt({ x: 60, y: 60 }), SHOP.id)
    expect(next.get(DIALOGUES[3].id)).toBe(previous.get(DIALOGUES[3].id))
  })

  it('falls back to a full build when the moved id names no zone', () => {
    expect([...reindexMovedZone(new Map(), DIALOGUES, ZONES, asZoneId('deleted'))]).toEqual([
      ...indexDialoguesByZone(DIALOGUES, ZONES),
    ])
  })

  it('falls back to a full build when the previous index never saw a dialogue', () => {
    const stale = indexDialoguesByZone([DIALOGUES[0]], ZONES)
    expect([...reindexMovedZone(stale, DIALOGUES, ZONES, SHOP.id)]).toEqual([
      ...indexDialoguesByZone(DIALOGUES, ZONES),
    ])
  })
})

describe('countDialoguesByZone', () => {
  it('counts a dialogue for every zone containing it', () => {
    const dialogues = [
      dialogue('d1', HARBOUR, { x: 20, y: 20 }),
      dialogue('d2', HARBOUR, { x: 90, y: 90 }),
      dialogue('d3', HARBOUR, { x: 500, y: 500 }),
    ]
    const counts = countDialoguesByZone(indexDialoguesByZone(dialogues, [TOWN, SHOP]))
    expect(counts.get(TOWN.id)).toBe(2)
    expect(counts.get(SHOP.id)).toBe(1)
  })

  it('omits an empty zone, which callers read as zero', () => {
    const counts = countDialoguesByZone(indexDialoguesByZone([], [TOWN]))
    expect(counts.get(TOWN.id)).toBeUndefined()
  })
})

describe('dialoguesInZone', () => {
  it('is every dialogue inside the zone, direct or by overlap', () => {
    const dialogues = [
      dialogue('d1', HARBOUR, { x: 20, y: 20 }),
      dialogue('d2', HARBOUR, { x: 90, y: 90 }),
    ]
    const index = indexDialoguesByZone(dialogues, [TOWN, SHOP])
    expect([...dialoguesInZone(index, TOWN.id)]).toEqual([dialogues[0].id, dialogues[1].id])
    expect([...dialoguesInZone(index, SHOP.id)]).toEqual([dialogues[0].id])
  })
})

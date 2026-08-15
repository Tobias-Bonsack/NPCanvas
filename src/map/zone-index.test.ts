import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asZoneId } from '../project/ids.ts'
import type { Dialogue, MapId, Point, Zone } from '../project/types.ts'
import type { Rect } from './geometry.ts'
import { rectToPolygon } from './geometry.ts'
import { countDialoguesByZone, dialoguesInZone, indexDialoguesByZone } from './zone-index.ts'

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
    content: { kind: 'text', text: '' },
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

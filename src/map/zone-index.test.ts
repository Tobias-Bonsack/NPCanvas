import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asZoneId } from '../project/ids.ts'
import type { Dialogue, GameMap, MapId, Point, Zone } from '../project/types.ts'
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

function gameMap(
  id: MapId,
  placement: { origin: Point; scale?: number; size?: number },
): GameMap {
  return {
    id,
    name: String(id),
    file: { fileName: `map-${id}.png`, mimeType: 'image/png', byteSize: 10 },
    width: placement.size ?? 200,
    height: placement.size ?? 200,
    origin: placement.origin,
    scale: placement.scale ?? 1,
  }
}

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
    references: [],
  }
}

const HARBOUR_MAP = gameMap(HARBOUR, { origin: { x: 0, y: 0 } })
const CAVES_MAP = gameMap(CAVES, { origin: { x: 1000, y: 0 } })
const MAPS = [HARBOUR_MAP, CAVES_MAP]

const TOWN = zone('town', HARBOUR, { x: 0, y: 0, width: 100, height: 100 })
const SHOP = zone('shop', HARBOUR, { x: 10, y: 10, width: 20, height: 20 })

describe('indexDialoguesByZone', () => {
  it('orders overlapping zones smallest-area-first, whatever order they are given in', () => {
    const inShop = dialogue('d1', HARBOUR, { x: 20, y: 20 })
    expect(indexDialoguesByZone([inShop], [TOWN, SHOP], MAPS).get(inShop.id)).toEqual([
      SHOP.id,
      TOWN.id,
    ])
    expect(indexDialoguesByZone([inShop], [SHOP, TOWN], MAPS).get(inShop.id)).toEqual([
      SHOP.id,
      TOWN.id,
    ])
  })

  it('gives a dialogue in no zone an empty list rather than no entry', () => {
    const outside = dialogue('d1', HARBOUR, { x: 500, y: 500 })
    const index = indexDialoguesByZone([outside], [TOWN, SHOP], MAPS)
    expect(index.has(outside.id)).toBe(true)
    expect(index.get(outside.id)).toEqual([])
  })

  it('never matches a zone on a map lying elsewhere on the canvas, however the numbers line up', () => {
    const elsewhere = dialogue('d1', CAVES, { x: 20, y: 20 })
    expect(indexDialoguesByZone([elsewhere], [TOWN, SHOP], MAPS).get(elsewhere.id)).toEqual([])
  })

  it('classifies a pin exactly on a zone edge as inside, consistently on every edge', () => {
    const onEdge = [
      dialogue('top', HARBOUR, { x: 20, y: 10 }),
      dialogue('right', HARBOUR, { x: 30, y: 20 }),
      dialogue('bottom', HARBOUR, { x: 20, y: 30 }),
      dialogue('left', HARBOUR, { x: 10, y: 20 }),
      dialogue('corner', HARBOUR, { x: 10, y: 10 }),
    ]
    const index = indexDialoguesByZone(onEdge, [TOWN, SHOP], MAPS)
    for (const each of onEdge) {
      expect(index.get(each.id)).toEqual([SHOP.id, TOWN.id])
    }
  })

  it('keeps every dialogue when there are no zones at all', () => {
    const dialogues = [dialogue('d1', HARBOUR, { x: 1, y: 1 })]
    expect([...indexDialoguesByZone(dialogues, [], MAPS).values()]).toEqual([[]])
  })

  it('leaves a dialogue whose map is gone outside every zone', () => {
    const orphan = dialogue('d1', asMapId('deleted'), { x: 20, y: 20 })
    expect(indexDialoguesByZone([orphan], [TOWN, SHOP], MAPS).get(orphan.id)).toEqual([])
  })

  it('reclassifies after a zone moves, with the dialogue untouched', () => {
    const pin = dialogue('d1', HARBOUR, { x: 20, y: 20 })
    const moved: Zone = { ...SHOP, polygon: rectToPolygon({ x: 60, y: 60, width: 20, height: 20 }) }
    expect(indexDialoguesByZone([pin], [TOWN, moved], MAPS).get(pin.id)).toEqual([TOWN.id])
  })
})

// The bug canvas-space membership exists for: an interior imported as its own map and dropped onto
// the town it stands in, where the old map-local rule answered "outside every zone" for every pin.
describe('indexDialoguesByZone: maps overlaid on other maps', () => {
  const OVERWORLD = asMapId('overworld')
  const HOUSE = asMapId('house')

  const OVERWORLD_MAP = gameMap(OVERWORLD, { origin: { x: 0, y: 0 }, size: 400 })
  const HOUSE_MAP = gameMap(HOUSE, { origin: { x: 100, y: 100 }, scale: 0.5, size: 200 }) // canvas (100,100)-(200,200)
  const OVERLAID = [OVERWORLD_MAP, HOUSE_MAP]

  const MARKET = zone('market', OVERWORLD, { x: 100, y: 100, width: 150, height: 150 })
  const KITCHEN = zone('kitchen', HOUSE, { x: 0, y: 0, width: 200, height: 200 }) // raw area 40000 > market's 22500, but smaller on canvas

  it('gives a pin on the overlaid map the zone underneath it', () => {
    const indoors = dialogue('indoors', HOUSE, { x: 100, y: 100 })
    expect(indexDialoguesByZone([indoors], [MARKET], OVERLAID).get(indoors.id)).toEqual([
      MARKET.id,
    ])
  })

  it('orders by canvas area, so a scaled map cannot win on the size of its raw numbers', () => {
    const indoors = dialogue('indoors', HOUSE, { x: 100, y: 100 })
    expect(indexDialoguesByZone([indoors], [MARKET, KITCHEN], OVERLAID).get(indoors.id)).toEqual([
      KITCHEN.id,
      MARKET.id,
    ])
  })

  it('reads through the overlay in both directions, because a pin is only ever a point', () => {
    const outdoors = dialogue('outdoors', OVERWORLD, { x: 150, y: 150 }) // same canvas point as `indoors` above
    expect(indexDialoguesByZone([outdoors], [MARKET, KITCHEN], OVERLAID).get(outdoors.id)).toEqual([
      KITCHEN.id,
      MARKET.id,
    ])
  })

  it('stops at the edge of the zone, not at the edge of the overlaid map', () => {
    // Zone covers canvas (0,0)-(150,150); the house is (100,100)-(200,200) — only partly overlapping.
    const corner = zone('corner', OVERWORLD, { x: 0, y: 0, width: 150, height: 150 })
    const indoors = dialogue('indoors', HOUSE, { x: 190, y: 190 }) // canvas (195,195)
    expect(indexDialoguesByZone([indoors], [corner], OVERLAID).get(indoors.id)).toEqual([])
    const nearer = dialogue('nearer', HOUSE, { x: 20, y: 20 }) // canvas (110,110)
    expect(indexDialoguesByZone([nearer], [corner], OVERLAID).get(nearer.id)).toEqual([corner.id])
  })
})

// Three screens ask the same question of the same three arrays across route-change remounts, so
// the cache (identity in, identity out) is what makes navigating between them free.
describe('indexDialoguesByZone: caching', () => {
  const ZONES = [TOWN, SHOP]
  const DIALOGUES = [dialogue('d1', HARBOUR, { x: 20, y: 20 })]

  it('returns the identical index for the identical arrays', () => {
    const first = indexDialoguesByZone(DIALOGUES, ZONES, MAPS)
    expect(indexDialoguesByZone(DIALOGUES, ZONES, MAPS)).toBe(first)
  })

  it('recomputes when any array is a different reference, however equal it looks', () => {
    const first = indexDialoguesByZone(DIALOGUES, ZONES, MAPS)
    expect(indexDialoguesByZone([...DIALOGUES], ZONES, MAPS)).not.toBe(first)
    expect(indexDialoguesByZone(DIALOGUES, [...ZONES], MAPS)).not.toBe(first)
    expect(indexDialoguesByZone(DIALOGUES, ZONES, [...MAPS])).not.toBe(first)
  })

  it('serves the same answer it computed, not merely an equal one', () => {
    const other = [dialogue('d2', HARBOUR, { x: 90, y: 90 })]
    const first = indexDialoguesByZone(DIALOGUES, ZONES, MAPS)
    indexDialoguesByZone(other, ZONES, MAPS) // a different question in between
    const again = indexDialoguesByZone(DIALOGUES, ZONES, MAPS)
    expect(again).not.toBe(first)
    expect([...again]).toEqual([...first])
  })
})

// The incremental path must be indistinguishable from the definition it replaces, so every case
// compares it against a full rebuild rather than a hand-written expectation.
describe('reindexMovedZone', () => {
  const INTERIOR = asMapId('interior')
  const INTERIOR_MAP = gameMap(INTERIOR, { origin: { x: 40, y: 40 }, size: 20 }) // canvas (40,40)-(60,60), clear of the shop
  const DRAG_MAPS = [...MAPS, INTERIOR_MAP]

  const CAVE = zone('cave', CAVES, { x: 0, y: 0, width: 100, height: 100 })
  const ZONES = [TOWN, SHOP, CAVE]
  const DIALOGUES = [
    dialogue('in-shop', HARBOUR, { x: 20, y: 20 }),
    dialogue('in-town', HARBOUR, { x: 90, y: 90 }),
    dialogue('outside', HARBOUR, { x: 500, y: 500 }),
    dialogue('in-cave', CAVES, { x: 50, y: 50 }),
    dialogue('indoors', INTERIOR, { x: 10, y: 10 }),
  ]

  function shopAt(by: Point): Zone[] {
    return ZONES.map((each) =>
      each.id === SHOP.id ? { ...SHOP, polygon: translatePolygon(SHOP.polygon, by) } : each,
    )
  }

  it('agrees with a full rebuild wherever the zone is dragged to', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES, DRAG_MAPS)
    const offsets: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 35, y: 35 }, // onto the interior map, sharing neither the shop's map nor its coordinates

      { x: 70, y: 70 },
      { x: -40, y: -40 },
      { x: 480, y: 480 },
      { x: 9000, y: 9000 },
    ]
    for (const by of offsets) {
      const drawn = shopAt(by)
      expect([...reindexMovedZone(previous, DIALOGUES, drawn, DRAG_MAPS, SHOP.id)]).toEqual([
        ...indexDialoguesByZone(DIALOGUES, drawn, DRAG_MAPS),
      ])
    }
  })

  it('claims a pin on an overlaid map the moment the zone is dragged under it', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES, DRAG_MAPS)
    expect(previous.get(DIALOGUES[4].id)).toEqual([TOWN.id])
    const over = reindexMovedZone(previous, DIALOGUES, shopAt({ x: 35, y: 35 }), DRAG_MAPS, SHOP.id)
    expect(over.get(DIALOGUES[4].id)).toEqual([SHOP.id, TOWN.id])
  })

  it('re-inserts the zone where its area puts it, not wherever it left from', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES, DRAG_MAPS)
    const away = reindexMovedZone(previous, DIALOGUES, shopAt({ x: 60, y: 60 }), DRAG_MAPS, SHOP.id) // out of the pin
    expect(away.get(DIALOGUES[0].id)).toEqual([TOWN.id])
    const back = reindexMovedZone(away, DIALOGUES, shopAt({ x: 0, y: 0 }), DRAG_MAPS, SHOP.id)
    expect(back.get(DIALOGUES[0].id)).toEqual([SHOP.id, TOWN.id])
  })

  it('returns the previous index itself when the move changed no membership', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES, DRAG_MAPS)
    expect(reindexMovedZone(previous, DIALOGUES, shopAt({ x: 1, y: 1 }), DRAG_MAPS, SHOP.id)).toBe( // a pixel of travel, no edge crossed
      previous,
    )
  })

  it('leaves the entries of dialogues the zone cannot reach untouched, by reference', () => {
    const previous = indexDialoguesByZone(DIALOGUES, ZONES, DRAG_MAPS)
    const next = reindexMovedZone(previous, DIALOGUES, shopAt({ x: 60, y: 60 }), DRAG_MAPS, SHOP.id)
    expect(next.get(DIALOGUES[3].id)).toBe(previous.get(DIALOGUES[3].id))
  })

  it('falls back to a full build when the moved id names no zone', () => {
    expect([
      ...reindexMovedZone(new Map(), DIALOGUES, ZONES, DRAG_MAPS, asZoneId('deleted')),
    ]).toEqual([...indexDialoguesByZone(DIALOGUES, ZONES, DRAG_MAPS)])
  })

  it('falls back to a full build when the moved zone sits on a map that is gone', () => {
    const orphaned = [...ZONES, zone('ghost', asMapId('deleted'), { x: 0, y: 0, width: 5, height: 5 })]
    expect([
      ...reindexMovedZone(new Map(), DIALOGUES, orphaned, DRAG_MAPS, asZoneId('ghost')),
    ]).toEqual([...indexDialoguesByZone(DIALOGUES, orphaned, DRAG_MAPS)])
  })

  it('falls back to a full build when the previous index never saw a dialogue', () => {
    const stale = indexDialoguesByZone([DIALOGUES[0]], ZONES, DRAG_MAPS)
    expect([...reindexMovedZone(stale, DIALOGUES, ZONES, DRAG_MAPS, SHOP.id)]).toEqual([
      ...indexDialoguesByZone(DIALOGUES, ZONES, DRAG_MAPS),
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
    const counts = countDialoguesByZone(indexDialoguesByZone(dialogues, [TOWN, SHOP], MAPS))
    expect(counts.get(TOWN.id)).toBe(2)
    expect(counts.get(SHOP.id)).toBe(1)
  })

  it('omits an empty zone, which callers read as zero', () => {
    const counts = countDialoguesByZone(indexDialoguesByZone([], [TOWN], MAPS))
    expect(counts.get(TOWN.id)).toBeUndefined()
  })
})

describe('dialoguesInZone', () => {
  it('is every dialogue inside the zone, direct or by overlap', () => {
    const dialogues = [
      dialogue('d1', HARBOUR, { x: 20, y: 20 }),
      dialogue('d2', HARBOUR, { x: 90, y: 90 }),
    ]
    const index = indexDialoguesByZone(dialogues, [TOWN, SHOP], MAPS)
    expect([...dialoguesInZone(index, TOWN.id)]).toEqual([dialogues[0].id, dialogues[1].id])
    expect([...dialoguesInZone(index, SHOP.id)]).toEqual([dialogues[0].id])
  })
})

import { describe, expect, it } from 'vitest'
import { asMapId, asZoneId } from '../project/ids.ts'
import type { GameMap, Point, Zone } from '../project/types.ts'
import {
  MAP_LAYOUT_GAP,
  canvasRectToMapLocal,
  canvasToMapLocal,
  clampMapScale,
  mapAtCanvasPoint,
  mapCanvasRect,
  mapLocalToCanvas,
  mapsBounds,
  nextMapOrigin,
  originForScale,
  zoneAtCanvasPoint,
  zoneCanvasRect,
} from './canvas-layout.ts'
import type { Rect } from './geometry.ts'
import { rectToPolygon } from './geometry.ts'

function gameMap(
  id: string,
  placement: { origin: Point; scale: number; width?: number; height?: number },
): GameMap {
  return {
    id: asMapId(id),
    name: id,
    file: { fileName: `map-${id}.png`, mimeType: 'image/png', byteSize: 10 },
    width: placement.width ?? 100,
    height: placement.height ?? 80,
    origin: placement.origin,
    scale: placement.scale,
  }
}

function expectClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9)
  expect(actual.y).toBeCloseTo(expected.y, 9)
}

describe('mapCanvasRect', () => {
  it('takes the natural size through the map scale', () => {
    const map = gameMap('a', { origin: { x: 10, y: -20 }, scale: 2.5, width: 200, height: 100 })
    expect(mapCanvasRect(map)).toEqual({ x: 10, y: -20, width: 500, height: 250 })
  })
})

describe('zoneCanvasRect', () => {
  it('takes the polygon bounds through the map origin and scale', () => {
    const map = gameMap('a', { origin: { x: 100, y: 50 }, scale: 2 })
    const zone: Zone = {
      id: asZoneId('shop'),
      mapId: map.id,
      name: 'shop',
      polygon: rectToPolygon({ x: 10, y: 20, width: 30, height: 5 }),
      hue: 200,
    }
    // Map-local (10, 20) through origin 100/50 and scale 2 lands at canvas (120, 90); the
    // 30x5 box scales the same way the map's own footprint does in mapCanvasRect.
    expect(zoneCanvasRect(map, zone)).toEqual({ x: 120, y: 90, width: 60, height: 10 })
  })
})

describe('mapLocalToCanvas / canvasToMapLocal', () => {
  it('round trips at a non-1 scale', () => {
    const map = gameMap('a', { origin: { x: -37.5, y: 480 }, scale: 0.375 })
    for (const point of [{ x: 0, y: 0 }, { x: 100, y: 80 }, { x: -12.25, y: 9001 }]) {
      expectClose(canvasToMapLocal(map, mapLocalToCanvas(map, point)), point)
    }
  })

  it('puts the map-local origin at the map origin, and the far corner at the rect corner', () => {
    const map = gameMap('a', { origin: { x: 500, y: 300 }, scale: 2, width: 200, height: 100 })
    expectClose(mapLocalToCanvas(map, { x: 0, y: 0 }), { x: 500, y: 300 })
    expectClose(mapLocalToCanvas(map, { x: 200, y: 100 }), { x: 900, y: 500 })
  })
})

describe('mapsBounds', () => {
  it('is null for a project with no maps, so no caller can fit to a degenerate rect', () => {
    expect(mapsBounds([])).toBeNull()
  })

  it('encloses disjoint maps', () => {
    const bounds = mapsBounds([
      gameMap('a', { origin: { x: 0, y: 0 }, scale: 1, width: 100, height: 80 }),
      gameMap('b', { origin: { x: 300, y: 200 }, scale: 1, width: 100, height: 80 }),
    ])
    expect(bounds).toEqual({ x: 0, y: 0, width: 400, height: 280 })
  })

  it('encloses overlapping maps without double-counting the overlap', () => {
    const bounds = mapsBounds([
      gameMap('a', { origin: { x: 0, y: 0 }, scale: 1, width: 100, height: 100 }),
      gameMap('b', { origin: { x: 50, y: 50 }, scale: 1, width: 100, height: 100 }),
    ])
    expect(bounds).toEqual({ x: 0, y: 0, width: 150, height: 150 })
  })

  it('accounts for scale and for negative origins', () => {
    const bounds = mapsBounds([
      gameMap('a', { origin: { x: -200, y: -100 }, scale: 0.5, width: 100, height: 100 }),
      gameMap('b', { origin: { x: 0, y: 0 }, scale: 3, width: 100, height: 100 }),
    ])
    expect(bounds).toEqual({ x: -200, y: -100, width: 500, height: 400 })
  })

  it('is the rect of the single map it is given', () => {
    const map = gameMap('a', { origin: { x: 7, y: 9 }, scale: 2 })
    expect(mapsBounds([map])).toEqual(mapCanvasRect(map))
  })
})

describe('mapAtCanvasPoint', () => {
  const lower = gameMap('lower', { origin: { x: 0, y: 0 }, scale: 1, width: 100, height: 100 })
  const upper = gameMap('upper', { origin: { x: 50, y: 50 }, scale: 1, width: 100, height: 100 })

  it('prefers the topmost of two overlapping maps, i.e. the last one rendered', () => {
    expect(mapAtCanvasPoint([lower, upper], { x: 75, y: 75 })?.id).toBe('upper')
    expect(mapAtCanvasPoint([upper, lower], { x: 75, y: 75 })?.id).toBe('lower')
  })

  it('finds the only map covering a point outside the overlap', () => {
    expect(mapAtCanvasPoint([lower, upper], { x: 10, y: 10 })?.id).toBe('lower')
    expect(mapAtCanvasPoint([lower, upper], { x: 140, y: 140 })?.id).toBe('upper')
  })

  it('is null outside every map, and for a project with no maps', () => {
    expect(mapAtCanvasPoint([lower, upper], { x: -1, y: 50 })).toBeNull()
    expect(mapAtCanvasPoint([lower, upper], { x: 500, y: 500 })).toBeNull()
    expect(mapAtCanvasPoint([], { x: 0, y: 0 })).toBeNull()
  })

  it('counts the map edge as inside, so a pin can be placed on the border', () => {
    expect(mapAtCanvasPoint([lower], { x: 0, y: 0 })?.id).toBe('lower')
    expect(mapAtCanvasPoint([lower], { x: 100, y: 100 })?.id).toBe('lower')
  })

  it('respects the map scale rather than its natural size', () => {
    const scaled = gameMap('scaled', { origin: { x: 0, y: 0 }, scale: 0.5, width: 100, height: 100 })
    expect(mapAtCanvasPoint([scaled], { x: 40, y: 40 })?.id).toBe('scaled')
    expect(mapAtCanvasPoint([scaled], { x: 60, y: 60 })).toBeNull()
  })
})

describe('nextMapOrigin', () => {
  it('is the canvas origin for an empty project', () => {
    expect(nextMapOrigin([])).toEqual({ x: 0, y: 0 })
  })

  it('places the new map a gap to the right of the current bounds', () => {
    const maps = [gameMap('a', { origin: { x: 0, y: 0 }, scale: 1, width: 100, height: 80 })]
    expect(nextMapOrigin(maps)).toEqual({ x: 100 + MAP_LAYOUT_GAP, y: 0 })
  })

  it('never overlaps what is already placed, however the maps are scaled or positioned', () => {
    const maps = [
      gameMap('a', { origin: { x: -50, y: 200 }, scale: 3, width: 100, height: 100 }),
      gameMap('b', { origin: { x: 400, y: -100 }, scale: 0.5, width: 100, height: 100 }),
    ]
    const origin = nextMapOrigin(maps)
    const bounds = mapsBounds(maps)
    expect(bounds).not.toBeNull()
    if (bounds === null) return
    expect(origin.x).toBeGreaterThan(bounds.x + bounds.width)
    expect(mapAtCanvasPoint(maps, origin)).toBeNull()
  })
})

describe('originForScale', () => {
  it('keeps the map centre fixed', () => {
    const map = gameMap('a', { origin: { x: 100, y: 100 }, scale: 1, width: 200, height: 100 })
    const centre = { x: 200, y: 150 }

    for (const scale of [0.5, 2, 3.25]) {
      const scaled = { ...map, scale, origin: originForScale(map, scale) }
      const rect = mapCanvasRect(scaled)
      expectClose({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, centre)
    }
  })

  it('is a no-op at the scale the map already has', () => {
    const map = gameMap('a', { origin: { x: 12, y: -8 }, scale: 1.75 })
    expectClose(originForScale(map, map.scale), map.origin)
  })
})

describe('canvasRectToMapLocal', () => {
  it('agrees with canvasToMapLocal on both corners', () => {
    const map = gameMap('a', { origin: { x: 40, y: -10 }, scale: 2 })
    const rect = { x: 60, y: 30, width: 80, height: 50 }
    const local = canvasRectToMapLocal(map, rect)

    expectClose({ x: local.x, y: local.y }, canvasToMapLocal(map, { x: rect.x, y: rect.y }))
    expectClose(
      { x: local.x + local.width, y: local.y + local.height },
      canvasToMapLocal(map, { x: rect.x + rect.width, y: rect.y + rect.height }),
    )
  })

  it('is the identity for a map at the origin at native size', () => {
    const map = gameMap('a', { origin: { x: 0, y: 0 }, scale: 1 })
    const rect = { x: 5, y: 6, width: 7, height: 8 }
    expect(canvasRectToMapLocal(map, rect)).toEqual(rect)
  })
})

describe('clampMapScale', () => {
  it('clamps at both ends and passes the range through untouched', () => {
    expect(clampMapScale(0.001)).toBe(0.1)
    expect(clampMapScale(0.1)).toBe(0.1)
    expect(clampMapScale(1)).toBe(1)
    expect(clampMapScale(10)).toBe(10)
    expect(clampMapScale(1000)).toBe(10)
  })

  it('absorbs NaN as native size, and sends infinities to the ends', () => {
    expect(clampMapScale(Number.NaN)).toBe(1)
    expect(clampMapScale(Number.POSITIVE_INFINITY)).toBe(10)
    expect(clampMapScale(Number.NEGATIVE_INFINITY)).toBe(0.1)
  })
})

describe('zoneAtCanvasPoint', () => {
  const map = gameMap('a', { origin: { x: 100, y: 100 }, scale: 2 })
  const neighbour = gameMap('b', { origin: { x: 500, y: 100 }, scale: 1 })

  function zone(id: string, mapId: string, rect: Rect): Zone {
    return {
      id: asZoneId(id),
      mapId: asMapId(mapId),
      name: id,
      polygon: rectToPolygon(rect),
      hue: 200,
    }
  }

  const town = zone('town', 'a', { x: 0, y: 0, width: 80, height: 80 })
  const shop = zone('shop', 'a', { x: 10, y: 10, width: 20, height: 20 })
  const elsewhere = zone('elsewhere', 'b', { x: 0, y: 0, width: 80, height: 80 })

  it('converts the query point into map-local space before testing', () => {
    // Canvas (140, 140) is map-local (20, 20) at origin 100 and scale 2 — inside the shop.
    expect(zoneAtCanvasPoint([map], [town], { x: 140, y: 140 })?.id).toBe(town.id)
    expect(zoneAtCanvasPoint([map], [town], { x: 100, y: 100 })?.id).toBe(town.id)
  })

  it('returns the smallest containing zone, whatever order they are listed in', () => {
    expect(zoneAtCanvasPoint([map], [town, shop], { x: 140, y: 140 })?.id).toBe(shop.id)
    expect(zoneAtCanvasPoint([map], [shop, town], { x: 140, y: 140 })?.id).toBe(shop.id)
    // Inside the town but outside the shop.
    expect(zoneAtCanvasPoint([map], [town, shop], { x: 220, y: 220 })?.id).toBe(town.id)
  })

  it('never picks a zone belonging to another map', () => {
    expect(zoneAtCanvasPoint([map, neighbour], [elsewhere], { x: 140, y: 140 })).toBeNull()
  })

  it('is null on bare canvas and on bare map', () => {
    expect(zoneAtCanvasPoint([map], [town], { x: 0, y: 0 })).toBeNull()
    expect(zoneAtCanvasPoint([map], [shop], { x: 280, y: 280 })).toBeNull()
  })
})

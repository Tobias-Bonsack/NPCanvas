import { describe, expect, it } from 'vitest'
import { asMapId } from '../project/ids.ts'
import type { GameMap, Point } from '../project/types.ts'
import {
  MAP_LAYOUT_GAP,
  canvasToMapLocal,
  clampMapScale,
  mapAtCanvasPoint,
  mapCanvasRect,
  mapLocalToCanvas,
  mapsBounds,
  nextMapOrigin,
  originForScale,
} from './canvas-layout.ts'

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

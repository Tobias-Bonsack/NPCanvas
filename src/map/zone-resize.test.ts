import { describe, expect, it } from 'vitest'
import type { Polygon } from '../project/types.ts'
import { polygonBounds, rectToPolygon } from './geometry.ts'
import { handleAtMapLocalPoint, resizePolygon, zoneHandlePoints } from './zone-resize.ts'

/** A 100x50 rectangle at (10, 20) — the shape the zone tool draws. */
const rectangle: Polygon = rectToPolygon({ x: 10, y: 20, width: 100, height: 50 })

/** A triangle, to pin that scaling preserves a shape rather than editing one vertex. */
const triangle: Polygon = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 20, y: 30 },
]

describe('zoneHandlePoints', () => {
  it('puts eight grips on the bounding box', () => {
    expect(zoneHandlePoints(rectangle)).toEqual([
      { handle: 'nw', point: { x: 10, y: 20 } },
      { handle: 'n', point: { x: 60, y: 20 } },
      { handle: 'ne', point: { x: 110, y: 20 } },
      { handle: 'e', point: { x: 110, y: 45 } },
      { handle: 'se', point: { x: 110, y: 70 } },
      { handle: 's', point: { x: 60, y: 70 } },
      { handle: 'sw', point: { x: 10, y: 70 } },
      { handle: 'w', point: { x: 10, y: 45 } },
    ])
  })

  it('boxes a non-rectangular polygon', () => {
    expect(zoneHandlePoints(triangle)[4]).toEqual({ handle: 'se', point: { x: 40, y: 30 } })
  })
})

describe('handleAtMapLocalPoint', () => {
  it('finds the grip a press lands near', () => {
    expect(handleAtMapLocalPoint(rectangle, { x: 112, y: 22 }, 5)).toBe('ne')
  })

  it('ignores a press beyond the tolerance', () => {
    expect(handleAtMapLocalPoint(rectangle, { x: 60, y: 45 }, 5)).toBe(null)
  })

  it('takes the boundary as a hit', () => {
    expect(handleAtMapLocalPoint(rectangle, { x: 15, y: 20 }, 5)).toBe('nw')
  })

  it('picks the nearest when grips overlap', () => {
    // A 4x4 zone: every grip is within a 10-unit tolerance of every other.
    const tiny = rectToPolygon({ x: 0, y: 0, width: 4, height: 4 })
    expect(handleAtMapLocalPoint(tiny, { x: 4.4, y: 4.4 }, 10)).toBe('se')
    expect(handleAtMapLocalPoint(tiny, { x: -0.4, y: -0.4 }, 10)).toBe('nw')
  })
})

describe('resizePolygon', () => {
  it('drags a corner and anchors the opposite one', () => {
    const resized = resizePolygon(rectangle, 'se', { x: 20, y: 10 }, 1)
    expect(polygonBounds(resized)).toEqual({ x: 10, y: 20, width: 120, height: 60 })
  })

  it('drags the north-west corner and anchors the south-east one', () => {
    const resized = resizePolygon(rectangle, 'nw', { x: -20, y: -10 }, 1)
    expect(polygonBounds(resized)).toEqual({ x: -10, y: 10, width: 120, height: 60 })
  })

  it('leaves the untouched axis of an edge grip alone', () => {
    // The east grip carries a vertical delta too — a pointer never moves on one axis only —
    // and the height must not follow it.
    const resized = resizePolygon(rectangle, 'e', { x: 50, y: 999 }, 1)
    expect(polygonBounds(resized)).toEqual({ x: 10, y: 20, width: 150, height: 50 })
  })

  it('scales every vertex, so a shape stretches instead of denting', () => {
    const resized = resizePolygon(triangle, 'e', { x: 40, y: 0 }, 1)
    expect(resized).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 40, y: 30 },
    ])
  })

  it('clamps at the floor rather than flipping the zone', () => {
    // Dragged 200 units left: the east edge would end up 100 units past the west one.
    const resized = resizePolygon(rectangle, 'e', { x: -200, y: 0 }, 8)
    expect(polygonBounds(resized)).toEqual({ x: 10, y: 20, width: 8, height: 50 })
  })

  it('leaves a degenerate axis alone instead of returning NaN', () => {
    const vertical: Polygon = [
      { x: 5, y: 0 },
      { x: 5, y: 10 },
      { x: 5, y: 20 },
    ]
    expect(resizePolygon(vertical, 'se', { x: 30, y: 10 }, 1)).toEqual([
      { x: 5, y: 0 },
      { x: 5, y: 15 },
      { x: 5, y: 30 },
    ])
  })

  it('returns the same shape for a zero delta', () => {
    expect(resizePolygon(rectangle, 'se', { x: 0, y: 0 }, 1)).toEqual(rectangle)
  })
})

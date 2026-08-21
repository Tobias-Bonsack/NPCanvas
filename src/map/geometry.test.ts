import { describe, expect, it } from 'vitest'
import type { Polygon } from '../project/types.ts'
import {
  inflate,
  isSamePolygon,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  rectBetween,
  rectContains,
  rectToPolygon,
  rectsOverlap,
  translatePolygon,
} from './geometry.ts'

describe('rectBetween', () => {
  it('describes the same rectangle whichever corner the drag started from', () => {
    const corners = [
      [
        { x: 10, y: 20 },
        { x: 40, y: 60 },
      ],
      [
        { x: 40, y: 60 },
        { x: 10, y: 20 },
      ],
      [
        { x: 40, y: 20 },
        { x: 10, y: 60 },
      ],
      [
        { x: 10, y: 60 },
        { x: 40, y: 20 },
      ],
    ] as const
    for (const [a, b] of corners) {
      expect(rectBetween(a, b)).toEqual({ x: 10, y: 20, width: 30, height: 40 })
    }
  })

  it('gives a click a rectangle of no size rather than a negative one', () => {
    expect(rectBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    })
  })
})

describe('inflate', () => {
  it('grows by a fraction of its own size, not by an absolute margin', () => {
    // 10% of 100 is 10 a side; 10% of 20 is 2 a side. The same margin, two different distances.
    expect(inflate({ x: 0, y: 0, width: 100, height: 20 }, 0.1)).toEqual({
      x: -10,
      y: -2,
      width: 120,
      height: 24,
    })
  })

  it('keeps the centre where it was', () => {
    const rect = { x: 30, y: 70, width: 40, height: 10 }
    const grown = inflate(rect, 0.25)
    expect(grown.x + grown.width / 2).toBeCloseTo(rect.x + rect.width / 2, 10)
    expect(grown.y + grown.height / 2).toBeCloseTo(rect.y + rect.height / 2, 10)
  })

  it('is the identity at a margin of zero', () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 }
    expect(inflate(rect, 0)).toEqual(rect)
  })

  it('shrinks on a negative margin, which is the same formula and not a special case', () => {
    expect(inflate({ x: 0, y: 0, width: 100, height: 100 }, -0.1)).toEqual({
      x: 10,
      y: 10,
      width: 80,
      height: 80,
    })
  })
})

describe('rectsOverlap', () => {
  const middle = { x: 10, y: 10, width: 20, height: 20 }

  it('is true for rectangles that share area, in either argument order', () => {
    const other = { x: 20, y: 20, width: 20, height: 20 }
    expect(rectsOverlap(middle, other)).toBe(true)
    expect(rectsOverlap(other, middle)).toBe(true)
  })

  it('counts a shared edge and a shared corner as overlapping', () => {
    expect(rectsOverlap(middle, { x: 30, y: 10, width: 5, height: 5 })).toBe(true)
    expect(rectsOverlap(middle, { x: 30, y: 30, width: 5, height: 5 })).toBe(true)
  })

  it('is false when they miss on either axis alone', () => {
    expect(rectsOverlap(middle, { x: 31, y: 10, width: 5, height: 5 })).toBe(false)
    expect(rectsOverlap(middle, { x: 10, y: 31, width: 5, height: 5 })).toBe(false)
  })

  it('is true for a rectangle wholly inside another', () => {
    expect(rectsOverlap(middle, { x: 15, y: 15, width: 1, height: 1 })).toBe(true)
  })
})

describe('rectContains', () => {
  const rect = { x: 10, y: 20, width: 30, height: 40 }

  it('accepts interior points and the boundary', () => {
    expect(rectContains(rect, { x: 25, y: 40 })).toBe(true)
    expect(rectContains(rect, { x: 10, y: 20 })).toBe(true)
    expect(rectContains(rect, { x: 40, y: 60 })).toBe(true)
  })

  it('rejects a point outside on any single axis', () => {
    expect(rectContains(rect, { x: 9.9, y: 40 })).toBe(false)
    expect(rectContains(rect, { x: 40.1, y: 40 })).toBe(false)
    expect(rectContains(rect, { x: 25, y: 19.9 })).toBe(false)
    expect(rectContains(rect, { x: 25, y: 60.1 })).toBe(false)
  })

  it('handles a rectangle at negative coordinates, which the shared canvas produces', () => {
    const shifted = { x: -50, y: -50, width: 20, height: 20 }
    expect(rectContains(shifted, { x: -40, y: -40 })).toBe(true)
    expect(rectContains(shifted, { x: 0, y: 0 })).toBe(false)
  })
})

const SQUARE: Polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

/**
 * An L. A point in the missing quadrant is inside the bounding box but outside the polygon,
 * which is exactly what a bounds-only implementation gets wrong.
 */
const L_SHAPE: Polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 100 },
  { x: 0, y: 100 },
]

/** Vertex 3 sits exactly on the edge from vertex 2 to vertex 4 — no area of its own. */
const COLLINEAR: Polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

describe('pointInPolygon: convex', () => {
  it('accepts an interior point', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, SQUARE)).toBe(true)
  })

  it('rejects points outside on every side', () => {
    expect(pointInPolygon({ x: -1, y: 50 }, SQUARE)).toBe(false)
    expect(pointInPolygon({ x: 101, y: 50 }, SQUARE)).toBe(false)
    expect(pointInPolygon({ x: 50, y: -1 }, SQUARE)).toBe(false)
    expect(pointInPolygon({ x: 50, y: 101 }, SQUARE)).toBe(false)
  })

  // The boundary is defined as inside, so these are assertions about a decision, not luck.
  it('counts every vertex as inside', () => {
    for (const vertex of SQUARE) expect(pointInPolygon(vertex, SQUARE)).toBe(true)
  })

  it('counts edge points as inside, including a horizontal edge', () => {
    expect(pointInPolygon({ x: 50, y: 0 }, SQUARE)).toBe(true)
    expect(pointInPolygon({ x: 100, y: 50 }, SQUARE)).toBe(true)
    expect(pointInPolygon({ x: 50, y: 100 }, SQUARE)).toBe(true)
    expect(pointInPolygon({ x: 0, y: 50 }, SQUARE)).toBe(true)
  })
})

describe('pointInPolygon: concave', () => {
  it('rejects the notch, which a bounding-box check would call inside', () => {
    const notch = { x: 70, y: 70 }
    const bounds = polygonBounds(L_SHAPE)
    expect(notch.x > bounds.x && notch.x < bounds.x + bounds.width).toBe(true)
    expect(notch.y > bounds.y && notch.y < bounds.y + bounds.height).toBe(true)
    expect(pointInPolygon(notch, L_SHAPE)).toBe(false)
  })

  it('accepts points in both arms of the L', () => {
    expect(pointInPolygon({ x: 70, y: 20 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 20, y: 70 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 20, y: 20 }, L_SHAPE)).toBe(true)
  })

  it('accepts the reflex vertex and the edges meeting at it', () => {
    expect(pointInPolygon({ x: 40, y: 40 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 40, y: 70 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 70, y: 40 }, L_SHAPE)).toBe(true)
  })

  // A ray cast along y = 40 grazes the two vertices at that height. Parity must not
  // double-count them, which is what the half-open vertical span in the loop guarantees.
  it('is not confused by a ray that passes through vertices', () => {
    expect(pointInPolygon({ x: 20, y: 40 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 120, y: 40 }, L_SHAPE)).toBe(false)
    expect(pointInPolygon({ x: -20, y: 40 }, L_SHAPE)).toBe(false)
  })
})

describe('pointInPolygon: collinear vertices', () => {
  it('behaves exactly like the square it degenerates to', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, COLLINEAR)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, COLLINEAR)).toBe(false)
    expect(pointInPolygon({ x: 100, y: 50 }, COLLINEAR)).toBe(true)
    expect(pointInPolygon({ x: 100, y: 75 }, COLLINEAR)).toBe(true)
  })
})

describe('polygonBounds', () => {
  it('is the axis-aligned box, ignoring vertex order', () => {
    expect(polygonBounds(L_SHAPE)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(
      polygonBounds([
        { x: 10, y: -5 },
        { x: -30, y: 12 },
        { x: 4, y: 40 },
      ]),
    ).toEqual({ x: -30, y: -5, width: 40, height: 45 })
  })
})

describe('polygonArea', () => {
  it('measures the square', () => {
    expect(polygonArea(SQUARE)).toBeCloseTo(10000, 9)
  })

  it('measures the L as the square minus its notch', () => {
    expect(polygonArea(L_SHAPE)).toBeCloseTo(10000 - 60 * 60, 9)
  })

  it('is unsigned, so winding direction does not matter', () => {
    const counterClockwise: Polygon = [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]
    expect(polygonArea(counterClockwise)).toBeCloseTo(polygonArea(SQUARE), 9)
  })

  it('is zero for a fully collinear polygon', () => {
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toBeCloseTo(0, 9)
  })
})

describe('polygonCentroid', () => {
  it('is the centre of a square', () => {
    const centroid = polygonCentroid(SQUARE)
    expect(centroid.x).toBeCloseTo(50, 9)
    expect(centroid.y).toBeCloseTo(50, 9)
  })

  it('is pulled towards the mass of a concave shape', () => {
    const centroid = polygonCentroid(L_SHAPE)
    expect(centroid.x).toBeCloseTo(centroid.y, 9)
    expect(centroid.x).toBeLessThan(50)
    expect(pointInPolygon(centroid, L_SHAPE)).toBe(true)
  })

  it('falls back to the vertex average when the area is zero', () => {
    const centroid = polygonCentroid([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ])
    expect(centroid.x).toBeCloseTo(10, 9)
    expect(centroid.y).toBeCloseTo(0, 9)
  })
})

describe('rectToPolygon', () => {
  it('produces the four corners of the rectangle', () => {
    expect(rectToPolygon({ x: 10, y: 20, width: 30, height: 40 })).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ])
  })

  it('round trips through bounds and area', () => {
    const rect = { x: -5, y: 7, width: 30, height: 40 }
    expect(polygonBounds(rectToPolygon(rect))).toEqual(rect)
    expect(polygonArea(rectToPolygon(rect))).toBeCloseTo(1200, 9)
  })
})

describe('translatePolygon', () => {
  it('shifts every vertex and leaves area and shape alone', () => {
    const moved = translatePolygon(rectToPolygon({ x: 0, y: 0, width: 10, height: 20 }), {
      x: -3,
      y: 4,
    })
    expect(moved).toEqual([
      { x: -3, y: 4 },
      { x: 7, y: 4 },
      { x: 7, y: 24 },
      { x: -3, y: 24 },
    ])
    expect(polygonArea(moved)).toBeCloseTo(200, 9)
  })

  it('keeps the vertices beyond the third, which the tuple type does not name', () => {
    const pentagon: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 12, y: 6 },
      { x: 5, y: 10 },
      { x: -2, y: 6 },
    ]
    expect(translatePolygon(pentagon, { x: 1, y: 1 })).toHaveLength(5)
  })
})

describe('isSamePolygon', () => {
  const rect = rectToPolygon({ x: 0, y: 0, width: 10, height: 10 })

  it('accepts a vertex-wise identical polygon and rejects any difference', () => {
    expect(isSamePolygon(rect, rectToPolygon({ x: 0, y: 0, width: 10, height: 10 }))).toBe(true)
    expect(isSamePolygon(rect, translatePolygon(rect, { x: 0, y: 1 }))).toBe(false)
    expect(isSamePolygon(rect, translatePolygon(rect, { x: 0, y: 0 }))).toBe(true)
  })

  it('rejects polygons of different lengths', () => {
    expect(
      isSamePolygon(rect, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(false)
  })
})

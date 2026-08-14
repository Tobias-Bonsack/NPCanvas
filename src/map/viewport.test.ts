import { describe, expect, it } from 'vitest'
import type { Point } from '../project/types.ts'
import type { Viewport } from './viewport.ts'
import {
  clampScale,
  fitRectToContainer,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
} from './viewport.ts'

const VIEWPORTS: readonly Viewport[] = [
  { x: 0, y: 0, scale: 1 },
  { x: 120, y: -40, scale: 0.35 },
  { x: -1000.5, y: 2000.25, scale: 3.75 },
]

const POINTS: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 512, y: 512 },
  { x: -37.5, y: 9001 },
]

function expectClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9)
  expect(actual.y).toBeCloseTo(expected.y, 9)
}

describe('worldToScreen / screenToWorld', () => {
  it('round trips every point through every viewport', () => {
    for (const viewport of VIEWPORTS) {
      for (const point of POINTS) {
        expectClose(screenToWorld(viewport, worldToScreen(viewport, point)), point)
      }
    }
  })

  it('puts the viewport origin at the screen origin', () => {
    const viewport: Viewport = { x: 120, y: -40, scale: 0.35 }
    expectClose(worldToScreen(viewport, { x: 120, y: -40 }), { x: 0, y: 0 })
  })

  it('scales world distance into screen distance', () => {
    const viewport: Viewport = { x: 0, y: 0, scale: 2 }
    expectClose(worldToScreen(viewport, { x: 100, y: 50 }), { x: 200, y: 100 })
  })
})

// The whole point of zoomAt: whatever was under the cursor stays under the cursor.
describe('zoomAt', () => {
  it('leaves the world point under the anchor unchanged', () => {
    const anchors: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 640, y: 360 },
      { x: 1279, y: 12 },
    ]
    for (const viewport of VIEWPORTS) {
      for (const anchor of anchors) {
        for (const factor of [1.1, 0.9, 2, 0.5]) {
          const before = screenToWorld(viewport, anchor)
          const after = screenToWorld(zoomAt(viewport, anchor, factor), anchor)
          expectClose(after, before)
        }
      }
    }
  })

  it('multiplies the scale by the factor', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 100 }, 2).scale).toBeCloseTo(2, 9)
  })

  it('holds the anchor even when the factor is clamped away', () => {
    const viewport: Viewport = { x: 0, y: 0, scale: 6 }
    const anchor: Point = { x: 300, y: 200 }
    const zoomed = zoomAt(viewport, anchor, 100)
    expect(zoomed.scale).toBe(8)
    expectClose(screenToWorld(zoomed, anchor), screenToWorld(viewport, anchor))
  })
})

describe('clampScale', () => {
  it('clamps at both ends and passes the range through untouched', () => {
    expect(clampScale(0.0001)).toBe(0.05)
    expect(clampScale(0.05)).toBe(0.05)
    expect(clampScale(1)).toBe(1)
    expect(clampScale(8)).toBe(8)
    expect(clampScale(1000)).toBe(8)
  })

  it('absorbs NaN rather than poisoning the viewport, and sends infinities to the ends', () => {
    expect(clampScale(Number.NaN)).toBe(0.05)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(8)
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(0.05)
  })
})

describe('fitRectToContainer', () => {
  it('centres a rect in a container wider than the rect aspect', () => {
    const rect = { x: 0, y: 0, width: 1000, height: 1000 }
    const container = { width: 800, height: 400 }
    const viewport = fitRectToContainer(rect, container)

    // Height is the binding dimension, so the whole rect height exactly fills the container.
    expect(viewport.scale).toBeCloseTo(0.4, 9)
    expectClose(worldToScreen(viewport, { x: 500, y: 500 }), { x: 400, y: 200 })
    expectClose(worldToScreen(viewport, { x: 0, y: 0 }), { x: 200, y: 0 })
    expectClose(worldToScreen(viewport, { x: 1000, y: 1000 }), { x: 600, y: 400 })
  })

  it('centres a rect in a container taller than the rect aspect', () => {
    const rect = { x: 0, y: 0, width: 1000, height: 1000 }
    const container = { width: 400, height: 800 }
    const viewport = fitRectToContainer(rect, container)

    expect(viewport.scale).toBeCloseTo(0.4, 9)
    expectClose(worldToScreen(viewport, { x: 500, y: 500 }), { x: 200, y: 400 })
    expectClose(worldToScreen(viewport, { x: 0, y: 0 }), { x: 0, y: 200 })
    expectClose(worldToScreen(viewport, { x: 1000, y: 1000 }), { x: 400, y: 600 })
  })

  it('centres a non-square rect too', () => {
    const viewport = fitRectToContainer(
      { x: 0, y: 0, width: 4000, height: 1000 },
      { width: 800, height: 800 },
    )
    expect(viewport.scale).toBeCloseTo(0.2, 9)
    expectClose(worldToScreen(viewport, { x: 2000, y: 500 }), { x: 400, y: 400 })
  })

  // The canvas is shared, so `mapsBounds` may start anywhere — a fit that assumed an origin
  // of 0,0 would put the maps off screen by exactly the bounds offset.
  it('honours a rect that does not start at the origin, including negative coordinates', () => {
    const rect = { x: -3000, y: 500, width: 1000, height: 1000 }
    const container = { width: 800, height: 400 }
    const viewport = fitRectToContainer(rect, container)

    expect(viewport.scale).toBeCloseTo(0.4, 9)
    expectClose(worldToScreen(viewport, { x: -2500, y: 1000 }), { x: 400, y: 200 })
    expectClose(worldToScreen(viewport, { x: -3000, y: 500 }), { x: 200, y: 0 })
    expectClose(worldToScreen(viewport, { x: -2000, y: 1500 }), { x: 600, y: 400 })
  })

  it('clamps a fit that would exceed the scale range', () => {
    expect(
      fitRectToContainer({ x: 0, y: 0, width: 10, height: 10 }, { width: 4000, height: 4000 }).scale,
    ).toBe(8)
    expect(
      fitRectToContainer(
        { x: 0, y: 0, width: 100000, height: 100000 },
        { width: 100, height: 100 },
      ).scale,
    ).toBe(0.05)
  })
})

describe('visibleWorldRect', () => {
  it('is the container rectangle expressed in world units', () => {
    const viewport: Viewport = { x: 100, y: 50, scale: 2 }
    expect(visibleWorldRect(viewport, { width: 800, height: 600 })).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 300,
    })
  })

  it('agrees with screenToWorld at both container corners', () => {
    const viewport: Viewport = { x: -12.5, y: 33, scale: 0.4 }
    const container = { width: 1280, height: 720 }
    const rect = visibleWorldRect(viewport, container)
    expectClose({ x: rect.x, y: rect.y }, screenToWorld(viewport, { x: 0, y: 0 }))
    expectClose(
      { x: rect.x + rect.width, y: rect.y + rect.height },
      screenToWorld(viewport, { x: container.width, y: container.height }),
    )
  })
})

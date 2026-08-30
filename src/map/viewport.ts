import type { Point } from '../project/types.ts'
import type { Rect, Size } from './geometry.ts'

// x/y is the world point at the screen origin, so the canvas CSS is scale(scale) translate(-x, -y).
// World space here is canvas space, not any one map's pixels — see canvas-layout.ts.
export type Viewport = { x: number; y: number; scale: number }

const MIN_SCALE = 0.05
const MAX_SCALE = 8

export function worldToScreen(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.x) * viewport.scale,
    y: (point.y - viewport.y) * viewport.scale,
  }
}

export function screenToWorld(viewport: Viewport, point: Point): Point {
  return {
    x: point.x / viewport.scale + viewport.x,
    y: point.y / viewport.scale + viewport.y,
  }
}

// Pins the world point currently under screenAnchor, so wheel zoom feels anchored at the cursor.
export function zoomAt(viewport: Viewport, screenAnchor: Point, factor: number): Viewport {
  const scale = clampScale(viewport.scale * factor)
  const anchoredWorld = screenToWorld(viewport, screenAnchor)
  return {
    x: anchoredWorld.x - screenAnchor.x / scale,
    y: anchoredWorld.y - screenAnchor.y / scale,
    scale,
  }
}

export function clampScale(scale: number): number {
  // A NaN scale poisons the viewport permanently (every later transform is NaN); it arises from
  // a 0/0 fit against an unlaid-out container, so absorb it rather than prevent it.
  if (Number.isNaN(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

const FIT_MARGIN = 0.04

// Takes a Rect, not a Size — mapsBounds may start at negative coordinates, so 0,0 can't be assumed.
export function fitRectToContainer(rect: Rect, container: Size): Viewport {
  const scale = clampScale(
    Math.min(container.width / rect.width, container.height / rect.height) * (1 - 2 * FIT_MARGIN),
  )
  return {
    x: rect.x + rect.width / 2 - container.width / (2 * scale),
    y: rect.y + rect.height / 2 - container.height / (2 * scale),
    scale,
  }
}

export function visibleWorldRect(viewport: Viewport, container: Size): Rect {
  const topLeft = screenToWorld(viewport, { x: 0, y: 0 })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: container.width / viewport.scale,
    height: container.height / viewport.scale,
  }
}

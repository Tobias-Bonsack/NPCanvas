import type { Point } from '../project/types.ts'
import type { Rect, Size } from './geometry.ts'

/**
 * The single source of truth for the map canvas transform. Every coordinate conversion in
 * the app goes through here — no component re-derives one inline.
 *
 * `x`/`y` is the **world point at the screen origin**, so the CSS the canvas emits is
 * `scale(scale) translate(-x, -y)`, in that order.
 */
export type Viewport = { x: number; y: number; scale: number }

/** Below 0.05 a map is a smudge; above 8 the source pixels are the only thing visible. */
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

/**
 * Scales by `factor` while pinning the world point currently under `screenAnchor`. That
 * invariant is what makes wheel zoom feel anchored at the cursor instead of at a corner.
 */
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
  // A NaN scale poisons the viewport permanently — every subsequent transform is NaN and
  // the canvas renders nothing, with no error anywhere. It arises from a 0/0 fit against a
  // container that has not been laid out yet, so it is cheaper to absorb than to prevent.
  // Infinities need no special case: Math.min/max already send them to the range ends.
  if (Number.isNaN(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Largest scale that shows the whole map, with the map centred in the container. */
export function fitToContainer(world: Size, container: Size): Viewport {
  const scale = clampScale(
    Math.min(container.width / world.width, container.height / world.height),
  )
  return {
    x: world.width / 2 - container.width / (2 * scale),
    y: world.height / 2 - container.height / (2 * scale),
    scale,
  }
}

/** The world-space rectangle currently on screen. Culling input once pin counts justify it. */
export function visibleWorldRect(viewport: Viewport, container: Size): Rect {
  const topLeft = screenToWorld(viewport, { x: 0, y: 0 })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: container.width / viewport.scale,
    height: container.height / viewport.scale,
  }
}

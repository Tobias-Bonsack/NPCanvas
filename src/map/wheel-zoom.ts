import type { Point } from '../project/types.ts'

/**
 * What a wheel event means to the canvas.
 *
 * Its own module rather than three functions inside `MapCanvas.tsx`, because this is real
 * branching maths and the testing policy in CLAUDE.md only reaches modules with a `.test.ts`
 * sibling — a component file has none and cannot get one.
 *
 * **The convention, which is a platform fact and not derivable from the code:** Chromium
 * reports a trackpad pinch as a wheel event with `ctrlKey` set, and a two-finger scroll as a
 * plain one. So `ctrlKey` zooms and a plain scroll pans — the same split Figma and every other
 * canvas tool uses. A mouse wheel is a plain scroll and therefore pans too; ctrl and the wheel
 * is how a mouse zooms. The previous mapping had it backwards: it zoomed on a plain scroll,
 * zoomed harder on a pinch, and left the trackpad with no way to pan at all.
 */
export type WheelInput = {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
}

/**
 * `WheelEvent.deltaMode` values, named here rather than read off the global. Tests run under
 * `environment: 'node'`, where `WheelEvent` does not exist.
 */
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

/** A line and a page, in pixels. Chromium's own figures for a default-sized viewport. */
const PIXELS_PER_LINE = 16
const PIXELS_PER_PAGE = 400

/**
 * Wheel delta in pixels, on both axes.
 *
 * `deltaX` is not optional: a trackpad's two-finger scroll is diagonal as often as not, and a
 * horizontal-only flick reports nothing on `deltaY` at all.
 */
export function normalizeDelta(event: WheelInput): Point {
  const unit = pixelsPerUnit(event.deltaMode)
  return { x: event.deltaX * unit, y: event.deltaY * unit }
}

function pixelsPerUnit(deltaMode: number): number {
  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return PIXELS_PER_LINE
    case DOM_DELTA_PAGE:
      return PIXELS_PER_PAGE
    default:
      return 1
  }
}

/**
 * How much a pinch changes the scale. Exponential, so a notch zooms by the same *ratio* at
 * every scale — linear steps crawl when zoomed out and jump when zoomed in.
 *
 * Deliberately defined for a plain scroll too, and deliberately not called for one: a caller
 * that hands this a non-pinch event gets a well-defined answer rather than a special case, and
 * the decision of which gesture zooms is made once, in the caller, where it is readable.
 */
export function wheelZoomFactor(event: WheelInput): number {
  return Math.exp(-normalizeDelta(event).y * ZOOM_PER_PIXEL)
}

/**
 * Chromium reports a pinch as a wheel event with much smaller deltas than a mouse notch, which
 * is what this coefficient is sized against.
 */
const ZOOM_PER_PIXEL = 0.01

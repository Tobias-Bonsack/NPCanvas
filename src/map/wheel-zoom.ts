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
 * plain one. Both zoom here, because the wheel is this canvas's zoom control: a game map is
 * looked at, not scrolled through, and the plain notch is the gesture a mouse actually has.
 * Panning is the drag, and `shiftKey` keeps a scroll-to-pan for a trackpad that wants one.
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
 * How much a wheel notch or a pinch changes the scale. Exponential, so a notch zooms by the
 * same *ratio* at every scale — linear steps crawl when zoomed out and jump when zoomed in.
 *
 * Deliberately independent of the modifier keys: which gesture zooms is decided once, in the
 * caller, where it is readable — this answers the same for a pinch and for a mouse notch.
 */
export function wheelZoomFactor(event: WheelInput): number {
  return Math.exp(-clampToNotch(normalizeDelta(event).y) * ZOOM_PER_PIXEL)
}

/**
 * The two gestures that zoom report wildly different magnitudes for the same intent: Chromium
 * sends a trackpad pinch as a handful of pixels per event, and one mouse notch as ~100 (a full
 * page, 400, on `DOM_DELTA_PAGE`). Feeding both through the same exponent unclamped makes a
 * single notch nearly triple the scale. Clamping the delta first is what lets one coefficient
 * serve both: a pinch stays below the cap and keeps its fine grain, a notch saturates at a
 * comfortable step, and the function stays symmetric so out-and-back returns to where it was.
 */
function clampToNotch(deltaY: number): number {
  return Math.max(-MAX_ZOOM_PIXELS, Math.min(MAX_ZOOM_PIXELS, deltaY))
}

const MAX_ZOOM_PIXELS = 20
const ZOOM_PER_PIXEL = 0.01

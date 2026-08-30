import type { Point } from '../project/types.ts'

// Platform fact: Chromium reports a trackpad pinch as a wheel event with ctrlKey set, and a
// two-finger scroll as a plain one. Both zoom here — the wheel is this canvas's zoom control.
// Panning is the drag; shiftKey keeps a scroll-to-pan for a trackpad that wants one.
export type WheelInput = {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
}

// WheelEvent.deltaMode values, named here since tests run under environment: 'node' where
// WheelEvent doesn't exist.
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

const PIXELS_PER_LINE = 16
const PIXELS_PER_PAGE = 400

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

// Exponential, so a notch zooms by the same ratio at every scale.
export function wheelZoomFactor(event: WheelInput): number {
  return Math.exp(-clampToNotch(normalizeDelta(event).y) * ZOOM_PER_PIXEL)
}

// A pinch reports a handful of pixels per event, a mouse notch ~100 (DOM_DELTA_PAGE) — clamping
// first lets one coefficient serve both without a notch nearly tripling the scale.
function clampToNotch(deltaY: number): number {
  return Math.max(-MAX_ZOOM_PIXELS, Math.min(MAX_ZOOM_PIXELS, deltaY))
}

const MAX_ZOOM_PIXELS = 20
const ZOOM_PER_PIXEL = 0.01

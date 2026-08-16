import type { Point } from '../project/types.ts'

/** Screen pixels of travel before a press stops being a click and becomes a drag. */
export const DRAG_THRESHOLD = 4

/**
 * The part of an element pointer capture needs, and the part of a pointer event a drag reads.
 * Structural rather than `HTMLElement` and `PointerEvent`, so React's synthetic event satisfies
 * it at every call site and a test needs no DOM.
 */
type CaptureTarget = {
  setPointerCapture: (pointerId: number) => void
  hasPointerCapture: (pointerId: number) => boolean
  releasePointerCapture: (pointerId: number) => void
}

export type DragPointerEvent = {
  pointerId: number
  clientX: number
  clientY: number
  currentTarget: CaptureTarget
}

/**
 * A gesture in flight: the pointer that owns it, where it started, whatever the caller
 * snapshotted at pointerdown, and whether it has travelled far enough to stop being a click.
 *
 * `data` is the caller's own shape — a viewport, a map origin, a zone — because the bookkeeping
 * is identical for all of them and only the payload differs.
 */
export type DragGesture<T> = {
  readonly pointerId: number
  readonly origin: Point
  readonly data: T
  moved: boolean
}

/** A `useRef` cell and nothing more, so a test can pass a plain object. */
export type DragGestureRef<T> = { current: DragGesture<T> | null }

/**
 * Takes the pointer and snapshots the caller's state. `false` means a gesture was already in
 * flight and this press is to be ignored — a second pointer landing mid-drag would otherwise
 * replace the first one's origin and teleport whatever is being dragged by the delta so far.
 */
export function beginDrag<T>(ref: DragGestureRef<T>, event: DragPointerEvent, data: T): boolean {
  if (ref.current !== null) return false
  // Capture keeps pointermove flowing after the cursor leaves the element, so a fast drag does
  // not strand the gesture half-finished.
  event.currentTarget.setPointerCapture(event.pointerId)
  ref.current = {
    pointerId: event.pointerId,
    origin: { x: event.clientX, y: event.clientY },
    data,
    moved: false,
  }
  return true
}

export type DragMove<T> = {
  data: T
  dx: number
  dy: number
  /** True on the one move that first passed the threshold, so a caller can promote a layer once. */
  started: boolean
}

/**
 * The travel since pointerdown, or `null` when the event belongs to another pointer or the
 * press has not yet stopped being a candidate click. Below the threshold a hand-shake of a
 * pixel would otherwise swallow the click.
 */
export function moveDrag<T>(ref: DragGestureRef<T>, event: DragPointerEvent): DragMove<T> | null {
  const gesture = ref.current
  if (gesture === null || gesture.pointerId !== event.pointerId) return null
  const dx = event.clientX - gesture.origin.x
  const dy = event.clientY - gesture.origin.y
  if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return null
  const started = !gesture.moved
  gesture.moved = true
  return { data: gesture.data, dx, dy, started }
}

export type DragEnd<T> = { data: T; moved: boolean }

/**
 * One of the two terminals: the gesture happened, and the caller may act on it. Releases the
 * capture and clears the ref. `null` when the event belongs to another pointer, in which case
 * nothing was in flight for it and the caller must do nothing.
 */
export function commitDrag<T>(ref: DragGestureRef<T>, event: DragPointerEvent): DragEnd<T> | null {
  const gesture = endDrag(ref, event)
  if (gesture === null) return null
  return { data: gesture.data, moved: gesture.moved }
}

/**
 * The other terminal: the platform said the gesture did not happen — an OS takeover, a touch
 * promoted to a browser gesture, a pen leaving range. It yields no payload, so a caller cannot
 * dispatch a cancelled gesture's result by accident; there is none to dispatch. The boolean
 * says only whether *this* pointer's gesture was the one withdrawn, which is what tells a
 * caller whether to drop its preview or leave another pointer's drag alone.
 */
export function cancelDrag<T>(ref: DragGestureRef<T>, event: DragPointerEvent): boolean {
  return endDrag(ref, event) !== null
}

function endDrag<T>(ref: DragGestureRef<T>, event: DragPointerEvent): DragGesture<T> | null {
  const gesture = ref.current
  if (gesture === null || gesture.pointerId !== event.pointerId) return null
  ref.current = null
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return gesture
}

import type { Point } from '../project/types.ts'

export const DRAG_THRESHOLD = 4

// Structural, not HTMLElement/PointerEvent, so React's synthetic event satisfies it and a test
// needs no DOM.
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

// `data` is the caller's own payload shape (a viewport, a map origin, a zone) — the pointer
// bookkeeping here is identical for all of them.
export type DragGesture<T> = {
  readonly pointerId: number
  readonly origin: Point
  readonly data: T
  moved: boolean
}

export type DragGestureRef<T> = { current: DragGesture<T> | null }

// `false` means a gesture was already in flight — a second pointer landing mid-drag would
// otherwise replace the first one's origin and teleport whatever is being dragged.
export function beginDrag<T>(ref: DragGestureRef<T>, event: DragPointerEvent, data: T): boolean {
  if (ref.current !== null) return false
  event.currentTarget.setPointerCapture(event.pointerId) // keeps pointermove flowing off-element
  ref.current = {
    pointerId: event.pointerId,
    origin: { x: event.clientX, y: event.clientY },
    data,
    moved: false,
  }
  return true
}

type DragMove<T> = {
  data: T
  dx: number
  dy: number
  // True on the one move that first passed the threshold, so a caller can promote a layer once.
  started: boolean
}

// `null` when the event belongs to another pointer, or below DRAG_THRESHOLD (a hand-shake pixel
// would otherwise swallow the click).
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

type DragEnd<T> = { data: T; moved: boolean }

// The gesture happened; the caller may act on it. `null` when the event belongs to another pointer.
export function commitDrag<T>(ref: DragGestureRef<T>, event: DragPointerEvent): DragEnd<T> | null {
  const gesture = endDrag(ref, event)
  if (gesture === null) return null
  return { data: gesture.data, moved: gesture.moved }
}

// The platform withdrew the gesture. Yields no payload — there is nothing to dispatch. The
// boolean says only whether this pointer's gesture was the one withdrawn.
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

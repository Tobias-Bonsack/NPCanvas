import { useRef } from 'react'
import type { Point } from '../project/types.ts'
import type { DragGesture, DragGestureRef, DragPointerEvent } from './drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from './drag-gesture.ts'
import type { Viewport } from './viewport.ts'
import { screenToWorld } from './viewport.ts'

/**
 * What a pan snapshots: the canvas point that was under the pointer when it went down. Every
 * move puts that point back under the pointer at the **live** scale — which is the invariant
 * `zoomAt` maintains as well, so a wheel notch mid-pan applies, stays applied, and the next
 * move continues from it rather than reverting to the scale the press started with.
 *
 * The delta is still measured against one snapshotted origin; the origin is a world point
 * rather than a whole viewport, which is what makes it survive a zoom.
 */
export type PanGesture = { grabbed: Point }

type UsePanGestureArgs = {
  /** The viewport every in-flight gesture computes against — see `MapCanvas`. */
  viewportRef: { current: Viewport }
  applyViewport: (next: Viewport) => void
  setPanning: (panning: boolean) => void
}

export type PanGestureApi = {
  /** Whether a pan owns the pointer right now — `MapCanvas` reads this to arbitrate gestures. */
  ref: DragGestureRef<PanGesture>
  /** Takes the pointer for a pan, snapshotting the world point under `anchor`. */
  begin: (event: DragPointerEvent, anchor: Point) => boolean
  /** Applies the live delta to the viewport. `anchor` is container-relative, computed by the caller. */
  move: (event: DragPointerEvent, anchor: Point) => void
  /** Commits the gesture. `null` when this event belongs to another pointer. */
  end: (event: DragPointerEvent) => { moved: boolean } | null
  /** Withdraws the gesture with nothing to dispatch — see `MapCanvas`'s `onPointerCancel`. */
  cancel: (event: DragPointerEvent) => boolean
}

/** The canvas's default gesture: drag anywhere that isn't claimed by a more specific tool. */
export function usePanGesture({
  viewportRef,
  applyViewport,
  setPanning,
}: UsePanGestureArgs): PanGestureApi {
  const pan = useRef<DragGesture<PanGesture> | null>(null)

  function begin(event: DragPointerEvent, anchor: Point): boolean {
    return beginDrag(pan, event, { grabbed: screenToWorld(viewportRef.current, anchor) })
  }

  function move(event: DragPointerEvent, anchor: Point): void {
    const moved = moveDrag(pan, event)
    if (moved === null) return
    // Guarded on the transition: setting it every move would re-render on every frame, which
    // is exactly what the layer promotion exists to avoid.
    if (moved.started) setPanning(true)
    // The scale is the live one, never the snapshotted one: writing the snapshot back is what
    // used to revert a wheel zoom to the pre-gesture scale one frame after it applied.
    const { scale } = viewportRef.current
    applyViewport({
      x: moved.data.grabbed.x - anchor.x / scale,
      y: moved.data.grabbed.y - anchor.y / scale,
      scale,
    })
  }

  function end(event: DragPointerEvent): { moved: boolean } | null {
    const result = commitDrag(pan, event)
    // Runs on every exit path, this pointer's or another's, and states exactly what it means:
    // a pan is in flight. `data-panning` — and the `will-change` it drives — can therefore
    // neither be left stuck on nor be dropped out from under a live pan.
    setPanning(pan.current !== null)
    return result === null ? null : { moved: result.moved }
  }

  function cancel(event: DragPointerEvent): boolean {
    // Guarded on the return value: a cancel for a pointer that never owned a gesture must
    // leave the one in flight exactly as it is.
    const cancelled = cancelDrag(pan, event)
    if (cancelled) setPanning(false)
    return cancelled
  }

  return { ref: pan, begin, move, end, cancel }
}

import { useRef } from 'react'
import type { Point } from '../project/types.ts'
import type { DragGesture, DragGestureRef, DragPointerEvent } from './drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from './drag-gesture.ts'
import type { Viewport } from './viewport.ts'
import { screenToWorld } from './viewport.ts'

// The world point under the pointer at pointerdown; the origin is a world point, not a whole
// viewport, so it survives a wheel zoom mid-pan (see zoomAt's matching invariant).
export type PanGesture = { grabbed: Point }

type UsePanGestureArgs = {
  viewportRef: { current: Viewport }
  applyViewport: (next: Viewport) => void
  setPanning: (panning: boolean) => void
}

export type PanGestureApi = {
  ref: DragGestureRef<PanGesture>
  begin: (event: DragPointerEvent, anchor: Point) => boolean
  move: (event: DragPointerEvent, anchor: Point) => void
  end: (event: DragPointerEvent) => { moved: boolean } | null
  cancel: (event: DragPointerEvent) => boolean
}

// The canvas's default gesture: drag anywhere not claimed by a more specific tool.
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
    if (moved.started) setPanning(true)
    const { scale } = viewportRef.current // live, not snapshotted — else a wheel zoom mid-pan reverts
    applyViewport({
      x: moved.data.grabbed.x - anchor.x / scale,
      y: moved.data.grabbed.y - anchor.y / scale,
      scale,
    })
  }

  function end(event: DragPointerEvent): { moved: boolean } | null {
    const result = commitDrag(pan, event)
    setPanning(pan.current !== null) // whether a pan is still in flight, this pointer's or another's
    return result === null ? null : { moved: result.moved }
  }

  function cancel(event: DragPointerEvent): boolean {
    const cancelled = cancelDrag(pan, event)
    if (cancelled) setPanning(false)
    return cancelled
  }

  return { ref: pan, begin, move, end, cancel }
}

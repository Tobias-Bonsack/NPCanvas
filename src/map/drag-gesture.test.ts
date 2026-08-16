import { describe, expect, it } from 'vitest'
import type { DragGestureRef, DragPointerEvent } from './drag-gesture.ts'
import { DRAG_THRESHOLD, beginDrag, cancelDrag, commitDrag, moveDrag } from './drag-gesture.ts'

/** The capture bookkeeping a real element does, as a plain object — these tests run in node. */
function captureTarget(): DragPointerEvent['currentTarget'] & { held: Set<number> } {
  const held = new Set<number>()
  return {
    held,
    setPointerCapture: (pointerId) => void held.add(pointerId),
    hasPointerCapture: (pointerId) => held.has(pointerId),
    releasePointerCapture: (pointerId) => void held.delete(pointerId),
  }
}

function pointerEvent(
  target: DragPointerEvent['currentTarget'],
  pointerId: number,
  x: number,
  y: number,
): DragPointerEvent {
  return { pointerId, clientX: x, clientY: y, currentTarget: target }
}

describe('beginDrag', () => {
  it('captures the pointer and snapshots the caller state', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }

    expect(beginDrag(ref, pointerEvent(target, 1, 10, 20), 'snapshot')).toBe(true)
    expect(ref.current?.data).toBe('snapshot')
    expect(ref.current?.origin).toEqual({ x: 10, y: 20 })
    expect(target.held.has(1)).toBe(true)
  })

  it('ignores a second pointer landing mid-gesture', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 10, 20), 'first')

    expect(beginDrag(ref, pointerEvent(target, 2, 400, 400), 'second')).toBe(false)
    expect(ref.current?.pointerId).toBe(1)
    expect(ref.current?.origin).toEqual({ x: 10, y: 20 })
    expect(ref.current?.data).toBe('first')
  })
})

describe('moveDrag', () => {
  it('reports nothing below the threshold and everything from it on', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')

    expect(moveDrag(ref, pointerEvent(target, 1, DRAG_THRESHOLD - 1, 0))).toBeNull()
    expect(ref.current?.moved).toBe(false)

    expect(moveDrag(ref, pointerEvent(target, 1, DRAG_THRESHOLD, 0))).toEqual({
      data: 'snapshot',
      dx: DRAG_THRESHOLD,
      dy: 0,
      started: true,
    })
    expect(ref.current?.moved).toBe(true)
  })

  it('passes the threshold once, then keeps reporting even back inside it', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')
    moveDrag(ref, pointerEvent(target, 1, 100, 0))

    expect(moveDrag(ref, pointerEvent(target, 1, 1, 0))).toEqual({
      data: 'snapshot',
      dx: 1,
      dy: 0,
      started: false,
    })
  })

  it('ignores another pointer', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')

    expect(moveDrag(ref, pointerEvent(target, 2, 100, 100))).toBeNull()
    expect(ref.current?.moved).toBe(false)
  })
})

describe('commitDrag', () => {
  it('returns the snapshot, releases the capture and clears the gesture', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')
    moveDrag(ref, pointerEvent(target, 1, 40, 0))

    expect(commitDrag(ref, pointerEvent(target, 1, 40, 0))).toEqual({
      data: 'snapshot',
      moved: true,
    })
    expect(ref.current).toBeNull()
    expect(target.held.has(1)).toBe(false)
  })

  it('reports a press that never passed the threshold as unmoved', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')

    expect(commitDrag(ref, pointerEvent(target, 1, 1, 1))?.moved).toBe(false)
  })

  it('ignores another pointer and leaves the gesture in flight', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')

    expect(commitDrag(ref, pointerEvent(target, 2, 0, 0))).toBeNull()
    expect(ref.current?.pointerId).toBe(1)
    expect(target.held.has(1)).toBe(true)
  })
})

describe('cancelDrag', () => {
  it('yields no payload: a commit after it finds nothing to commit', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')
    moveDrag(ref, pointerEvent(target, 1, 40, 0))

    expect(cancelDrag(ref, pointerEvent(target, 1, 40, 0))).toBe(true)

    expect(ref.current).toBeNull()
    expect(target.held.has(1)).toBe(false)
    expect(commitDrag(ref, pointerEvent(target, 1, 40, 0))).toBeNull()
  })

  it('ignores another pointer', () => {
    const target = captureTarget()
    const ref: DragGestureRef<string> = { current: null }
    beginDrag(ref, pointerEvent(target, 1, 0, 0), 'snapshot')

    expect(cancelDrag(ref, pointerEvent(target, 2, 0, 0))).toBe(false)

    expect(ref.current?.pointerId).toBe(1)
  })
})

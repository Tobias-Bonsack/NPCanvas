import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { DragGesture } from '../map/drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from '../map/drag-gesture.ts'
import { MIN_CANVAS_WIDTH, MIN_PANEL_WIDTH, clampPanelWidth } from './panel-width.ts'

// Both fields are re-measured per gesture, since the window can be resized between two of them.
type PanelResizeData = { startWidth: number; availableWidth: number }

const PANEL_WIDTH_STEP = 32

type PanelResizeApi = {
  resizing: boolean
  band: { width: number; max: number } | null
  beginResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  moveResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  endResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  cancelResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  stepResize: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

export function usePanelResize(
  asideRef: RefObject<HTMLElement | null>,
  onWidthChange: (width: number) => void,
  measureAvailableWidth: () => number,
  // 'right' (default) is a panel to the right of its handle, dragging left widens it — the
  // shape every existing caller has. 'left' mirrors both the drag and the arrow-key sign for a
  // panel to the left of its own handle (dragging right widens it).
  edge: 'left' | 'right' = 'right',
): PanelResizeApi {
  const sign = edge === 'right' ? -1 : 1
  // Bookkeeping lives in a ref, as every drag in this repo does — only the flag the handle and
  // Escape listener read is state.
  const resizeRef = useRef<DragGesture<PanelResizeData> | null>(null)
  const [resizing, setResizing] = useState(false)

  // Measured, not assumed — width may come from the stylesheet, a media query, or a drag.
  // Deliberately not what the clamp reads: a gesture measures for itself at pointerdown.
  const [band, setBand] = useState<{ width: number; max: number } | null>(null)
  const measureBand = useRef<() => void>(() => {})
  // No dependency list — every render is a chance the panel changed width, and returning the
  // previous object when nothing moved is what stops the setState from looping.
  useEffect(() => {
    const measure = (): void => {
      const aside = asideRef.current
      if (aside === null) return
      const measured = aside.getBoundingClientRect().width
      const max = Math.max(MIN_PANEL_WIDTH, measureAvailableWidth() - MIN_CANVAS_WIDTH)
      setBand((prev) =>
        prev !== null && prev.width === measured && prev.max === max
          ? prev
          : { width: measured, max },
      )
    }
    measureBand.current = measure
    measure()
  })

  // A window resize moves both ends of the band without rendering anything on its own.
  useEffect(() => {
    const onResize = (): void => measureBand.current()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function beginResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    const startWidth = asideRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH
    beginDrag(resizeRef, event, { startWidth, availableWidth: measureAvailableWidth() })
  }

  // Right-edge handle: travel to the left widens the panel, hence -dx. Left-edge handle mirrors
  // it (+dx) via `sign`.
  function moveResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const move = moveDrag(resizeRef, event)
    if (move === null) return
    if (move.started) setResizing(true)
    onWidthChange(
      clampPanelWidth(move.data.startWidth + sign * move.dx, move.data.availableWidth),
    )
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    if (commitDrag(resizeRef, event) === null) return
    setResizing(false)
  }

  function restoreWidth(data: PanelResizeData): void {
    onWidthChange(clampPanelWidth(data.startWidth, data.availableWidth))
  }

  // A cancel is not a shorter pointerup — the width goes back to where the press started.
  function cancelResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = resizeRef.current
    if (!cancelDrag(resizeRef, event)) return
    setResizing(false)
    if (gesture !== null) restoreWidth(gesture.data)
  }

  function stepResize(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // The separator moves the way the arrow points; `sign` accounts for which side the panel
    // sits on relative to the handle.
    const step =
      event.key === 'ArrowLeft'
        ? -sign * PANEL_WIDTH_STEP
        : event.key === 'ArrowRight'
          ? sign * PANEL_WIDTH_STEP
          : null
    if (step === null) return
    event.preventDefault()
    const current = asideRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH
    onWidthChange(clampPanelWidth(current + step, measureAvailableWidth()))
  }

  useEffect(() => {
    if (!resizing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const gesture = resizeRef.current
      resizeRef.current = null
      setResizing(false)
      if (gesture !== null) {
        onWidthChange(clampPanelWidth(gesture.data.startWidth, gesture.data.availableWidth))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [resizing, onWidthChange])

  return { resizing, band, beginResize, moveResize, endResize, cancelResize, stepResize }
}

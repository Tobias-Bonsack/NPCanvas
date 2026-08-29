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

/**
 * What a resize gesture snapshots at pointerdown: the width the panel actually had — which may
 * have come from the stylesheet rather than from a previous drag — and the width the panel and
 * the canvas share. Both are re-measured per gesture, because the window can be resized between
 * two of them.
 */
type PanelResizeData = { startWidth: number; availableWidth: number }

/** One press of an arrow key on the handle, in CSS pixels. */
const PANEL_WIDTH_STEP = 32

type PanelResizeApi = {
  /** True for the duration of a drag — the handle and the panel's own Escape listener both read it. */
  resizing: boolean
  /** What the handle announces: the panel's current width and the widest it may grow to. */
  band: { width: number; max: number } | null
  beginResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  moveResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  endResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  cancelResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  stepResize: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

/**
 * The panel's left-edge resize handle: a drag, an arrow-key step, and an Escape that withdraws
 * a drag in progress back to the width it started from.
 */
export function usePanelResize(
  asideRef: RefObject<HTMLElement | null>,
  onWidthChange: (width: number) => void,
  measureAvailableWidth: () => number,
): PanelResizeApi {
  // The resize gesture's own bookkeeping lives in a ref, exactly as every other drag in this
  // repo does; only the flag the handle and the Escape listener read is state, so a pointermove
  // costs one render of the panel and nothing else.
  const resizeRef = useRef<DragGesture<PanelResizeData> | null>(null)
  const [resizing, setResizing] = useState(false)

  // What the handle announces. Measured rather than assumed, because the panel's width may come
  // from the stylesheet, from one of its two media queries, or from a drag, and the maximum
  // moves whenever the window does. Deliberately *not* what the clamp reads — a gesture measures
  // for itself at pointerdown, since a number cached here would clamp against a stale window.
  const [band, setBand] = useState<{ width: number; max: number } | null>(null)
  const measureBand = useRef<() => void>(() => {})
  // No dependency list: every render is a chance the panel changed width, and returning the
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

  // The handle is on the *left* edge, so travel to the left widens the panel — hence `-dx`.
  function moveResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const move = moveDrag(resizeRef, event)
    if (move === null) return
    if (move.started) setResizing(true)
    onWidthChange(clampPanelWidth(move.data.startWidth - move.dx, move.data.availableWidth))
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    if (commitDrag(resizeRef, event) === null) return
    setResizing(false)
  }

  function restoreWidth(data: PanelResizeData): void {
    onWidthChange(clampPanelWidth(data.startWidth, data.availableWidth))
  }

  /**
   * The platform withdrew the gesture, so the width goes back to the one the press started
   * from — a cancel is not a shorter pointerup. Escape mid-drag is the same terminal, and the
   * effect below is where it lands: there is no pointer event for a key press.
   */
  function cancelResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = resizeRef.current
    if (!cancelDrag(resizeRef, event)) return
    setResizing(false)
    if (gesture !== null) restoreWidth(gesture.data)
  }

  function stepResize(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // The separator moves the way the arrow points; the panel is to its right, so left is wider.
    const step =
      event.key === 'ArrowLeft'
        ? PANEL_WIDTH_STEP
        : event.key === 'ArrowRight'
          ? -PANEL_WIDTH_STEP
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

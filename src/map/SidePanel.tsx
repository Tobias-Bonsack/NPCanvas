import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import { useEffect } from 'react'
import { MIN_PANEL_WIDTH } from '../dialogue/panel-width.ts'
import { usePanelResize } from '../dialogue/use-panel-resize.ts'
import './SidePanel.css'

/**
 * The `<aside>`, resize handle and `usePanelResize` band that `DialoguePanel` and
 * `CapturesPanel` share — one column exists at a time to its right of the canvas, and both
 * open at whatever width the other one was last dragged to (`CanvasViewState.panelWidth`).
 * Drag-and-drop props are optional: only the dialogue panel is a media drop target.
 */
export function SidePanel({
  panelRef,
  className,
  ariaLabel,
  resizerLabel,
  width,
  onWidthChange,
  measureAvailableWidth,
  dropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onResizingChange,
  children,
}: {
  panelRef: RefObject<HTMLElement | null>
  className: string
  ariaLabel: string
  resizerLabel: string
  width: number | null
  onWidthChange: (width: number) => void
  measureAvailableWidth: () => number
  dropTarget?: boolean
  onDragOver?: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave?: (event: ReactDragEvent<HTMLElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLElement>) => void
  /** A resize gesture holds Escape for itself — a caller with its own Escape-to-close needs to
   * know to stand down while one is in progress. */
  onResizingChange?: (resizing: boolean) => void
  children: ReactNode
}): ReactElement {
  const { resizing, band, beginResize, moveResize, endResize, cancelResize, stepResize } =
    usePanelResize(panelRef, onWidthChange, measureAvailableWidth)

  useEffect(() => {
    onResizingChange?.(resizing)
  }, [resizing, onResizingChange])

  return (
    <aside
      ref={panelRef}
      className={`side-panel ${className}`}
      aria-label={ariaLabel}
      // The custom property, not `width` — SidePanel.css's media queries redefine it, so a
      // dragged width outranks all three declarations.
      style={width === null ? undefined : sidePanelWidthStyle(width)}
      tabIndex={-1}
      data-drop-target={dropTarget === true ? 'true' : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Absolutely positioned against the aside, not laid out in the scrolling column below,
          so the handle stays reachable on a long panel. */}
      <div
        className="side-panel__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={resizerLabel}
        aria-valuenow={Math.round(band?.width ?? MIN_PANEL_WIDTH)}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={Math.round(band?.max ?? MIN_PANEL_WIDTH)}
        tabIndex={0}
        data-resizing={resizing ? 'true' : undefined}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={cancelResize}
        onKeyDown={stepResize}
      />
      <div className="side-panel__content">{children}</div>
    </aside>
  )
}

// Intersection type avoids an `as` cast — CSSProperties has no index signature for `--*`.
function sidePanelWidthStyle(width: number): CSSProperties & Record<'--side-panel-width', string> {
  return { '--side-panel-width': `${width}px` }
}

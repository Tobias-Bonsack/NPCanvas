import type { ReactElement } from 'react'
import { useAlertDialogFocus } from '../dialog-focus.ts'
import './CanvasDisplayDialog.css'

/**
 * What is drawn on the canvas beyond the pins themselves. Mounting *is* opening, matching
 * `GlyphSet.tsx` — `useAlertDialogFocus` traps Tab and handles Escape on `document` in the
 * capture phase, ahead of any window-bound Escape-to-close such as `DialoguePanel`'s own.
 */
export function CanvasDisplayDialog({
  questFilter,
  onToggleQuestFilter,
  questFilterDisabled,
  trail,
  onToggleTrail,
  trailDisabled,
  references,
  onToggleReferences,
  referencesDisabled,
  onClose,
}: {
  questFilter: boolean
  onToggleQuestFilter: () => void
  questFilterDisabled: boolean
  trail: boolean
  onToggleTrail: () => void
  trailDisabled: boolean
  references: boolean
  onToggleReferences: () => void
  referencesDisabled: boolean
  onClose: () => void
}): ReactElement {
  const ref = useAlertDialogFocus(onClose)
  return (
    <div className="canvas-display-dialog overlay-backdrop">
      <div
        ref={ref}
        className="canvas-display-dialog__panel card"
        role="dialog"
        aria-modal="true"
        aria-label="Canvas display settings"
        tabIndex={-1}
      >
        <header className="panel-header">
          <h2 className="panel-title">Display</h2>
        </header>

        <button
          type="button"
          className="quest-filter button"
          aria-pressed={questFilter}
          disabled={questFilterDisabled}
          title={
            questFilterDisabled
              ? 'No dialogue is attached to a quest yet'
              : 'Dim every pin no quest names'
          }
          onClick={onToggleQuestFilter}
        >
          Quest pins only
        </button>

        <button
          type="button"
          className="trail-toggle button"
          aria-pressed={trail}
          disabled={trailDisabled}
          title={
            trailDisabled
              ? 'Two lines have to be logged before there is an order to draw'
              : 'Draw a line through the pins, earliest line to latest'
          }
          onClick={onToggleTrail}
        >
          Time trail
        </button>

        <button
          type="button"
          className="reference-toggle button"
          aria-pressed={references}
          disabled={referencesDisabled}
          title={
            referencesDisabled
              ? 'No line points at another yet'
              : 'Draw an arrow from a line to what it points at'
          }
          onClick={onToggleReferences}
        >
          References
        </button>

        <footer className="panel-footer">
          <button type="button" className="canvas-display-dialog__button button--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

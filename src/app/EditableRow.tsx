import type { ReactElement, ReactNode } from 'react'
import { useAlertDialogFocus } from '../dialog-focus.ts'
import { useFieldDraft } from '../use-field-draft.ts'
import './EditableRow.css'

// The rename + delete-confirm interaction every list in this app shares — see use-editable-row.ts
// (split out only because react-refresh/only-export-components requires a component file to
// export nothing but components). Canonical Enter/Escape/blur behaviour: Enter commits, Escape
// discards and closes, blur commits, matching useFieldDraft's own contract.

// Escape resets the draft via draft.onChange rather than unmounting, since unmount is what
// useFieldDraft treats as flush — resetting first makes that flush a no-op.
export function EditableRowRenameForm({
  value,
  label,
  onCommit,
  close,
  className,
  inputClassName,
  saveLabel = 'Save',
}: {
  value: string
  label: string
  onCommit: (value: string) => void
  close: () => void
  className?: string
  inputClassName?: string
  saveLabel?: string
}): ReactElement {
  const draft = useFieldDraft(value, onCommit)
  return (
    <form
      className={className ?? 'editable-row__form'}
      onSubmit={(event) => {
        event.preventDefault()
        draft.flush()
        close()
      }}
    >
      <input
        className={inputClassName ?? 'editable-row__input'}
        value={draft.value}
        autoFocus
        aria-label={label}
        onChange={(event) => draft.onChange(event.target.value)}
        onBlur={() => {
          draft.flush()
          close()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // Stops a panel-level Escape handler from also treating this as "close the panel".
          event.stopPropagation()
          draft.onChange(value)
          close()
        }}
      />
      <button type="submit" className="button">
        {saveLabel}
      </button>
    </form>
  )
}

// Every caller gets useAlertDialogFocus's trap: focus moves in on mount, Tab can't leave, Escape
// cancels, and focus returns to whatever opened it on unmount.
export function EditableRowDeleteConfirm({
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  close,
  className,
  label,
  buttonClassName,
  dangerButtonClassName,
  dataCanvasUi,
}: {
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  close: () => void
  className?: string
  label?: string
  buttonClassName?: string
  dangerButtonClassName?: string
  // PinLayer's confirmation floats over the canvas, which treats a press outside
  // [data-canvas-ui] as the start of a pan/select gesture (MapCanvas.tsx's isCanvasChrome).
  dataCanvasUi?: boolean
}): ReactElement {
  const ref = useAlertDialogFocus(close)
  return (
    <div
      ref={ref}
      className={className ?? 'editable-row__confirm'}
      role="alertdialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-canvas-ui={dataCanvasUi ? true : undefined}
    >
      <span>{message}</span>
      <button
        type="button"
        className={dangerButtonClassName ?? 'button button--danger'}
        onClick={() => {
          onConfirm()
          close()
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className={buttonClassName ?? 'button'} onClick={close}>
        {cancelLabel}
      </button>
    </div>
  )
}

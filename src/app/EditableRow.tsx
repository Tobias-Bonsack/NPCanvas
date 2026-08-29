import type { ReactElement, ReactNode } from 'react'
import { useAlertDialogFocus } from '../dialog-focus.ts'
import { useFieldDraft } from '../use-field-draft.ts'
import './EditableRow.css'

/**
 * The two interactions every list in this app repeats: renaming a row and confirming its
 * deletion. Both used to be reimplemented per list — four divergent mode unions for renaming,
 * seven divergent delete confirmations, only one of which trapped focus. This file, plus the
 * state machine half in `use-editable-row.ts` beside it (split out only because
 * `react-refresh/only-export-components` requires a component file to export nothing but
 * components), is now the only place either is implemented; every caller wires its own markup
 * to `useEditableRow` plus `EditableRowRenameForm` / `EditableRowDeleteConfirm`, but the state
 * machine, the draft handling and the focus trap are never reimplemented.
 *
 * **Canonical Enter/Escape/blur behaviour**, chosen once here rather than left to drift per
 * caller: Enter commits immediately, Escape discards the draft and closes without committing,
 * and blur commits — matching `useFieldDraft`'s own contract ("bind to `onBlur` — and call
 * before anything reads the field's value out of the store"), which is also what the one
 * pre-existing `useFieldDraft` caller (`RelevanceTagList`) already did for blur. Escape resets
 * the draft to the committed value with `draft.onChange` rather than unmounting the field: an
 * unmount is what `useFieldDraft` treats as "flush", so unmounting on Escape would commit the
 * very draft Escape is supposed to discard. Resetting first makes the draft equal the committed
 * value, so the flush that follows is a no-op. The one edge this does not cover — the draft's
 * own 300 ms idle-flush firing before Escape is pressed — is accepted rather than special-cased:
 * every other field in the app built on `useFieldDraft` has the same window, and re-opening it
 * here would mean the rename form no longer drove the draft through the hook CLAUDE.md requires.
 */

/**
 * The rename field. `useFieldDraft` owns the draft; this only wires it to a field that commits
 * on Enter, discards on Escape and commits on blur — see the canonical-behaviour comment above.
 * Autofocus is safe because this component itself mounts fresh every time a row opens rename
 * mode (the caller renders it conditionally on the row's own mode), unlike the `useFieldDraft`
 * call inside it, which shares this component's own lifetime — there is no cross-row identity
 * concern here the way there is for `DialogueForm`.
 */
export function EditableRowRenameForm({
  value,
  label,
  onCommit,
  close,
  className,
  inputClassName,
  saveLabel = 'Save',
}: {
  /** The committed value — what Escape reverts to. */
  value: string
  /** `aria-label` for the field. */
  label: string
  onCommit: (value: string) => void
  /** Called once the row should return to idle, whether committed or cancelled. */
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
          // Stops the key here so a panel-level Escape handler (DialoguePanel's own
          // Escape-to-close, for one) never sees it as anything but "cancel this rename".
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

/**
 * The delete confirmation. Every caller gets `useAlertDialogFocus`'s trap — focus moves onto
 * this the moment it mounts, Tab cannot leave it, Escape cancels, and focus returns to whatever
 * opened it on unmount — for free, which is the accessibility fix the issue exists for as much
 * as the de-duplication is.
 */
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
  /** What the row asks — a plain sentence, or one built up with the counts a cascade affects. */
  message: ReactNode
  /** HeldNote spells this "Discard them" — its own wording, kept verbatim by the caller. */
  confirmLabel?: string
  cancelLabel?: string
  /** Runs before the row closes. Never called on cancel. */
  onConfirm: () => void
  close: () => void
  className?: string
  /** `aria-label` for the dialog, when the visible message alone should not stand in for it. */
  label?: string
  buttonClassName?: string
  dangerButtonClassName?: string
  /**
   * `PinLayer`'s confirmation floats over the canvas, which treats a press outside
   * `[data-canvas-ui]` as the start of a pan/select gesture — see `MapCanvas.tsx`'s
   * `isCanvasChrome`. Every other caller sits in an ordinary scrolling list and leaves this off.
   */
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

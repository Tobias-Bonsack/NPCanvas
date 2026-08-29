import type { ReactElement } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { EditableRowDeleteConfirm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { useHeldFrames } from './capture-watch.ts'
import './HeldNote.css'

// Shown whether or not the watcher is still running — the queue outlives it. Lives in
// `CaptureRecorder`, not the dialogue panel: a held frame belongs to the capture the watcher was
// recording when it read it, never to whichever line happens to be selected.
export function HeldNote({
  onAnswer,
  onDiscard,
  answerDisabled,
  discardDisabled,
}: {
  onAnswer: () => void
  onDiscard: () => void
  answerDisabled: boolean
  // Deliberately not `answerDisabled`: writing the queue needs a profile, discarding needs nothing.
  discardDisabled: boolean
}): ReactElement | null {
  const held = useHeldFrames()
  const editable = useEditableRow()
  if (held.waiting === 0 && held.dropped === 0) return null

  return (
    <div className="held-note" role="status">
      <p className="held-note__status">
        {held.waiting === 1
          ? '1 box is waiting for the alphabet'
          : `${held.waiting} boxes are waiting for the alphabet`}
        {held.dropped > 0 &&
          ` · ${held.dropped} older ${held.dropped === 1 ? 'one was' : 'ones were'} pushed out of the queue and lost`}
      </p>
      {held.waiting > 1 && (
        <Disclosure>
          <p className="held-note__hint hint-text">
            The boxes after the one it could not read are waiting with it, so the capture keeps its
            order.
          </p>
        </Disclosure>
      )}
      {held.waiting > 0 &&
        (editable.mode === 'delete' ? (
          <EditableRowDeleteConfirm
            message={
              <>
                Discard {held.waiting === 1 ? 'the waiting box' : `all ${held.waiting} waiting boxes`}?
                Nothing is written, and the pictures cannot be captured again.
              </>
            }
            confirmLabel="Discard them"
            onConfirm={onDiscard}
            close={editable.close}
            className="held-note__confirm"
          />
        ) : (
          <div className="held-note__actions">
            <button type="button" className="button" disabled={answerDisabled} onClick={onAnswer}>
              Name the tiles and write them
            </button>
            <button
              type="button"
              className="button"
              disabled={discardDisabled}
              title="Throw the waiting boxes away. The captures they were read for keep whatever is already in them."
              onClick={editable.openDelete}
            >
              Discard them
            </button>
          </div>
        ))}
    </div>
  )
}

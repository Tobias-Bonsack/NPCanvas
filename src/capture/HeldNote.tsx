import type { ReactElement } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { EditableRowDeleteConfirm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { useHeldFrames } from './capture-watch.ts'
import './HeldNote.css'

/**
 * The boxes the alphabet could not name, and the one control that turns them back into lines.
 *
 * Shown whether or not the watcher is still running: the queue outlives it, and the alphabet is
 * usually answered once the conversation is over. Its own subscription, like `WatcherStatus`.
 *
 * Lives in `CaptureRecorder`, not the dialogue panel (#109): a held frame belongs to the capture
 * the watcher was recording when it read it, never to whichever line happens to be selected —
 * #107 already made a selected line meaningless to the watcher, and the queue lives beside the
 * trigger that fills it.
 */
export function HeldNote({
  onAnswer,
  onDiscard,
  answerDisabled,
  discardDisabled,
}: {
  onAnswer: () => void
  onDiscard: () => void
  answerDisabled: boolean
  /**
   * Its own flag, and deliberately not `answerDisabled`: writing the queue needs a profile to read
   * the frames with, throwing it away needs nothing. A queue stuck behind a profile that was
   * deleted or re-calibrated is exactly the one the user wants rid of, so the two controls cannot
   * share a condition.
   */
  discardDisabled: boolean
}): ReactElement | null {
  const held = useHeldFrames()
  /** The confirm step is `EditableRow`'s own — this only supplies its wording, which stays
   *  verbatim: discarding held frames is the one place the watcher loses data on purpose. */
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
      {/* Why a conversation has stopped growing even though the watcher says it is reading: a box
          the alphabet cannot name holds up the boxes after it, because a held box can only ever be
          appended at the end of the capture it belongs to. */}
      {held.waiting > 1 && (
        <Disclosure>
          <p className="held-note__hint">
            The boxes after the one it could not read are waiting with it, so the capture keeps its
            order.
          </p>
        </Disclosure>
      )}
      {held.waiting > 0 &&
        (editable.mode === 'delete' ? (
          /* Confirmed rather than done on the click: a replay is the only other way these frames
             leave the queue, and the pixels are gone for good — the game has long since advanced
             past the box they show. */
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

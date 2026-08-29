import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { useEffect } from 'react'
import { EditableRowDeleteConfirm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { toLocalDateTimeValue } from '../dialogue/local-datetime.ts'
import { NpcNameInput } from '../dialogue/NpcNameInput.tsx'
import { npcNamesIn, previousRecordFor } from '../dialogue/recency.ts'
import { relevanceNames } from '../dialogue/relevance.ts'
import { RelevancePicker } from '../dialogue/RelevancePicker.tsx'
import { discardMedia } from '../media/discard-media.ts'
import { resolveGalleryIndex, stepGalleryIndex } from '../media/gallery-index.ts'
import { MediaView } from '../media/MediaView.tsx'
import { dispatch } from '../project/store.ts'
import type { PendingCapture, PendingCaptureId, ProjectFile } from '../project/types.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { useWatchState } from './capture-watch.ts'
import './PendingCaptureList.css'

// The triage queue, one capture at a time: several waiting conversations are alternatives to page
// between, not a list read top to bottom, so this shows a frame, a `Capture n of m` counter, and
// a thumbnail strip for whichever capture is on screen. The current capture's id lives in
// `MapScreen`, beside `armedCaptureId` — this component holds no state of its own.
export function PendingCaptureList({
  project,
  armedCaptureId,
  onArm,
  currentCaptureId,
  onSelect,
}: {
  project: ProjectFile
  armedCaptureId: PendingCaptureId | null
  onArm: (captureId: PendingCaptureId) => void
  currentCaptureId: PendingCaptureId | null
  onSelect: (captureId: PendingCaptureId) => void
}): ReactElement {
  const npcNames = npcNamesIn(project.dialogues)
  const captures = project.pendingCaptures

  const watch = useWatchState()
  const recordingCaptureId = watch.kind === 'watching' ? watch.captureId : null

  const index = resolveGalleryIndex(captures, currentCaptureId)
  const current = captures[index] ?? null
  const paged = captures.length > 1

  // The carousel follows the watcher: a fresh or reopened conversation is the one growing on
  // screen while it is recorded. Only fires again once `recordingCaptureId` changes, which lets
  // paging away by hand afterwards stick.
  useEffect(() => {
    if (recordingCaptureId !== null) onSelect(recordingCaptureId)
  }, [recordingCaptureId, onSelect])

  function page(delta: number): void {
    const next = captures[stepGalleryIndex(index, delta, captures.length)]
    if (next !== undefined) onSelect(next.id)
  }

  // Bound on the container, never on `window` — the sidebar sits beside a canvas that owns the
  // arrow keys (`MapScreen`'s tool shortcuts).
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!paged || isTextFieldFocused()) return
    if (event.key === 'ArrowLeft') page(-1)
    else if (event.key === 'ArrowRight') page(1)
    else return
    event.preventDefault()
  }

  async function onDeleteConfirmed(capture: PendingCapture): Promise<void> {
    dispatch({ kind: 'pending-capture/deleted', captureId: capture.id })
    await discardMedia(capture.media)
  }

  return (
    <div className="pending-capture-list" onKeyDown={onKeyDown}>
      {current === null ? (
        <p className="pending-capture-list__empty hint-text">
          Nothing waiting. Press New capture or Extend last to record a conversation.
        </p>
      ) : (
        <CaptureCard
          // Keyed so the delete confirmation cannot survive a page to a different capture.
          key={current.id}
          project={project}
          capture={current}
          captures={captures}
          index={index}
          paged={paged}
          npcNames={npcNames}
          armed={armedCaptureId === current.id}
          recording={recordingCaptureId === current.id}
          onArm={() => onArm(current.id)}
          onSelect={onSelect}
          onDeleteConfirmed={() => onDeleteConfirmed(current)}
        />
      )}
    </div>
  )
}

function CaptureCard({
  project,
  capture,
  captures,
  index,
  paged,
  npcNames,
  armed,
  recording,
  onArm,
  onSelect,
  onDeleteConfirmed,
}: {
  project: ProjectFile
  capture: PendingCapture
  captures: readonly PendingCapture[]
  index: number
  paged: boolean
  npcNames: readonly string[]
  armed: boolean
  recording: boolean
  onArm: () => void
  onSelect: (captureId: PendingCaptureId) => void
  onDeleteConfirmed: () => void
}): ReactElement {
  const editable = useEditableRow()
  const firstMedium = capture.media[0] ?? null
  // The most recently recorded other capture, offered as a one-click carry-over — in record
  // order, not paging order, so a reader who has paged elsewhere still gets the right one.
  const previous = previousRecordFor(project.pendingCaptures, capture.id)
  const previousHasSomething =
    previous !== null && (previous.npcName.trim() !== '' || previous.relevance.length > 0)

  return (
    <div
      className="pending-capture-list__row card"
      data-armed={armed ? 'true' : undefined}
      data-recording={recording ? 'true' : undefined}
    >
      <div className="pending-capture-list__frame">
        {firstMedium === null ? (
          <span className="pending-capture-list__no-picture">No picture</span>
        ) : (
          <MediaView media={firstMedium} label="First picture of this conversation" fit="fill" />
        )}
      </div>
      <p className="pending-capture-list__line">
        {capture.text.trim() === '' ? 'No line yet' : capture.text}
      </p>
      <p className="pending-capture-list__spoken-at hint-text">{toLocalDateTimeValue(capture.spokenAt)}</p>

      {paged && (
        <p className="pending-capture-list__count hint-text" role="status">
          Capture {index + 1} of {captures.length}
        </p>
      )}

      {paged && (
        <div className="pending-capture-list__strip">
          {captures.map((candidate, position) => (
            <button
              key={candidate.id}
              type="button"
              className="pending-capture-list__thumb strip-thumb"
              aria-current={candidate.id === capture.id ? 'true' : undefined}
              aria-label={`Capture ${position + 1}`}
              onClick={() => onSelect(candidate.id)}
            >
              <span className="pending-capture-list__thumb-media" inert>
                {candidate.media[0] === undefined ? (
                  <span className="pending-capture-list__thumb-empty">No picture</span>
                ) : (
                  <MediaView media={candidate.media[0]} label="" />
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <NpcNameInput
        id={`pending-capture-${capture.id}-npc`}
        value={capture.npcName}
        names={npcNames}
        onChange={(npcName) => dispatch({ kind: 'pending-capture/renamed', captureId: capture.id, npcName })}
        onBlur={() => {}}
      />

      {previousHasSomething && (
        <button
          type="button"
          className="pending-capture-list__carry-over"
          onClick={() => {
            dispatch({
              kind: 'pending-capture/renamed',
              captureId: capture.id,
              npcName: previous.npcName,
            })
            dispatch({
              kind: 'pending-capture/relevance-set',
              captureId: capture.id,
              relevance: previous.relevance,
            })
          }}
        >
          Same as {previous.npcName.trim() === '' ? 'the previous capture' : previous.npcName}
          {previous.relevance.length > 0 &&
            `: ${relevanceNames(previous.relevance, project.relevanceTags).join(', ')}`}
        </button>
      )}

      <RelevancePicker
        tags={project.relevanceTags}
        value={capture.relevance}
        onChange={(relevance) =>
          dispatch({ kind: 'pending-capture/relevance-set', captureId: capture.id, relevance })
        }
      />

      <div className="pending-capture-list__actions">
        <button
          type="button"
          className="button"
          aria-pressed={armed}
          data-armed={armed ? 'true' : undefined}
          onClick={onArm}
          title={
            armed
              ? 'Cancel — click a map, or Place on map again to stop'
              : 'Click a map to place this conversation there'
          }
        >
          {armed ? 'Placing… click a map' : 'Place on map'}
        </button>
        {editable.mode === 'delete' ? (
          <EditableRowDeleteConfirm
            message="Delete this capture and its pictures?"
            onConfirm={onDeleteConfirmed}
            close={editable.close}
            className="pending-capture-list__confirm"
          />
        ) : (
          <button type="button" className="button" onClick={editable.openDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

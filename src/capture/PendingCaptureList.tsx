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

/**
 * The triage queue, one capture at a time (#108). A session with several conversations waiting
 * is alternatives to page between while deciding where each one goes, not a list read top to
 * bottom — the same complaint `MediaGallery` answered for a line's own pictures, and the same
 * answer here: a frame, a `Capture n of m` counter, and a thumbnail strip, all about whichever
 * capture is on screen.
 *
 * The current capture's id lives in `MapScreen`, beside `armedCaptureId` — this component holds
 * no index or id state of its own, exactly as `MediaGallery` holds none of its own selection.
 */
export function PendingCaptureList({
  project,
  armedCaptureId,
  onArm,
  currentCaptureId,
  onSelect,
}: {
  project: ProjectFile
  /** The capture a click on the canvas will place next, or `null` — see `MapScreen`. */
  armedCaptureId: PendingCaptureId | null
  onArm: (captureId: PendingCaptureId) => void
  /** Which capture the carousel shows, or `null` — see `resolveGalleryIndex`'s fallback. */
  currentCaptureId: PendingCaptureId | null
  onSelect: (captureId: PendingCaptureId) => void
}): ReactElement {
  // Shared with `DialogueForm`'s own suggestions — recently spoken names read the same list.
  const npcNames = npcNamesIn(project.dialogues)
  const captures = project.pendingCaptures

  // Its own subscription, for the same reason `CaptureRecorder`'s is (#106): only this list
  // needs to know which capture is being written into right now.
  const watch = useWatchState()
  const recordingCaptureId = watch.kind === 'watching' ? watch.captureId : null

  const index = resolveGalleryIndex(captures, currentCaptureId)
  const current = captures[index] ?? null
  // With a single capture the counter and the strip are noise — nothing to page to — exactly as
  // `MediaGallery`'s `paged` at `src/media/MediaGallery.tsx:33-35`.
  const paged = captures.length > 1

  // The carousel follows the watcher: a fresh or reopened conversation is the one growing on
  // screen while it is recorded. This only fires again once `recordingCaptureId` itself changes
  // to a different capture, which is what lets paging away by hand afterwards stick.
  useEffect(() => {
    if (recordingCaptureId !== null) onSelect(recordingCaptureId)
  }, [recordingCaptureId, onSelect])

  function page(delta: number): void {
    const next = captures[stepGalleryIndex(index, delta, captures.length)]
    if (next !== undefined) onSelect(next.id)
  }

  // Bound on the container, never on `window` — the sidebar sits beside a canvas that owns the
  // arrow keys (`MapScreen`'s tool shortcuts), the same reason `MediaGallery` gives at
  // `src/media/MediaGallery.tsx:42-45`.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!paged || isTextFieldFocused()) return
    if (event.key === 'ArrowLeft') page(-1)
    else if (event.key === 'ArrowRight') page(1)
    else return
    event.preventDefault()
  }

  async function onDeleteConfirmed(capture: PendingCapture): Promise<void> {
    dispatch({ kind: 'pending-capture/deleted', captureId: capture.id })
    // Collected from the capture the caller already holds — the dispatch above is what makes
    // the document stop naming these files, so nothing after it could still list them.
    await discardMedia(capture.media)
  }

  return (
    <div className="pending-capture-list" onKeyDown={onKeyDown}>
      {current === null ? (
        <p className="pending-capture-list__empty">
          Nothing waiting. Press New capture or Extend last to record a conversation.
        </p>
      ) : (
        <CaptureCard
          // Keyed so the delete confirmation (`EditableRow`'s own local state) cannot survive a
          // page to a different capture — without this, confirming "Delete" after paging away
          // would delete whichever capture happened to be on screen when the key was pressed.
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
  /** The watcher is writing into this one right now — see `PendingCaptureList`'s own subscription. */
  recording: boolean
  onArm: () => void
  onSelect: (captureId: PendingCaptureId) => void
  onDeleteConfirmed: () => void
}): ReactElement {
  const editable = useEditableRow()
  const firstMedium = capture.media[0] ?? null
  // The most recently recorded other capture — offered as a one-click carry-over, exactly the
  // way a freshly placed dialogue offers the previous line's tags. Gated on there being
  // something in it worth copying, not on the capture being otherwise untouched: unlike a fresh
  // dialogue, a capture always already carries a line and a picture by the time it exists here.
  // Record order, not paging order — a reader who has paged elsewhere still gets offered the
  // capture that was actually recorded just before this one.
  const previous = previousRecordFor(project.pendingCaptures, capture.id)
  const previousHasSomething =
    previous !== null && (previous.npcName.trim() !== '' || previous.relevance.length > 0)

  return (
    <div
      className="pending-capture-list__row"
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
      <p className="pending-capture-list__spoken-at">{toLocalDateTimeValue(capture.spokenAt)}</p>

      {paged && (
        <p className="pending-capture-list__count" role="status">
          Capture {index + 1} of {captures.length}
        </p>
      )}

      {paged && (
        <div className="pending-capture-list__strip">
          {captures.map((candidate, position) => (
            <button
              key={candidate.id}
              type="button"
              className="pending-capture-list__thumb"
              aria-current={candidate.id === capture.id ? 'true' : undefined}
              aria-label={`Capture ${position + 1}`}
              onClick={() => onSelect(candidate.id)}
            >
              {/* `inert` because a thumbnail is a picture of a frame, not the frame: neither the
                  pointer nor the Tab key may reach a video's own controls inside a button whose
                  job is to select. */}
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

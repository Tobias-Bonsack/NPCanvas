import type { ReactElement } from 'react'
import { useState } from 'react'
import { toLocalDateTimeValue } from '../dialogue/local-datetime.ts'
import { NpcNameInput } from '../dialogue/NpcNameInput.tsx'
import { npcNamesIn, previousRecordFor } from '../dialogue/recency.ts'
import { relevanceNames } from '../dialogue/relevance.ts'
import { RelevancePicker } from '../dialogue/RelevancePicker.tsx'
import { discardMedia } from '../media/discard-media.ts'
import { MediaView } from '../media/MediaView.tsx'
import { dispatch } from '../project/store.ts'
import type { PendingCapture, PendingCaptureId, ProjectFile } from '../project/types.ts'
import './PendingCaptureList.css'

/**
 * Transient list UI — only the delete confirmation, since renaming and tagging dispatch
 * directly with no draft (see `CaptureRow`). See CLAUDE.md § Store scope.
 */
type ListMode = { kind: 'idle' } | { kind: 'confirming-delete'; id: PendingCaptureId }

/**
 * The triage queue: every conversation the watcher recorded with nothing selected, in the order
 * it happened, waiting for the two things only the player knows — where, and which map. Beside
 * `MapList` and `ZoneList` in the sidebar, following their structure rather than inventing a new
 * one.
 */
export function PendingCaptureList({
  project,
  armedCaptureId,
  onArm,
}: {
  project: ProjectFile
  /** The capture a click on the canvas will place next, or `null` — see `MapScreen`. */
  armedCaptureId: PendingCaptureId | null
  onArm: (captureId: PendingCaptureId) => void
}): ReactElement {
  const [mode, setMode] = useState<ListMode>({ kind: 'idle' })
  // Shared with `DialogueForm`'s own suggestions — recently spoken names read the same list.
  const npcNames = npcNamesIn(project.dialogues)

  async function onDeleteConfirmed(capture: PendingCapture): Promise<void> {
    dispatch({ kind: 'pending-capture/deleted', captureId: capture.id })
    setMode({ kind: 'idle' })
    // Collected from the capture the caller already holds — the dispatch above is what makes
    // the document stop naming these files, so nothing after it could still list them.
    await discardMedia(capture.media)
  }

  return (
    <div className="pending-capture-list">
      {project.pendingCaptures.length === 0 ? (
        <p className="pending-capture-list__empty">
          Nothing waiting. Switch the watcher on with no pin selected to record a conversation.
        </p>
      ) : (
        <ul className="pending-capture-list__items">
          {project.pendingCaptures.map((capture) => (
            <li key={capture.id} className="pending-capture-list__item">
              <CaptureRow
                project={project}
                capture={capture}
                npcNames={npcNames}
                armed={armedCaptureId === capture.id}
                onArm={() => onArm(capture.id)}
                mode={mode.kind === 'confirming-delete' && mode.id === capture.id ? mode : { kind: 'idle' }}
                onRequestDelete={() => setMode({ kind: 'confirming-delete', id: capture.id })}
                onCancelDelete={() => setMode({ kind: 'idle' })}
                onDeleteConfirmed={() => void onDeleteConfirmed(capture)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CaptureRow({
  project,
  capture,
  npcNames,
  armed,
  onArm,
  mode,
  onRequestDelete,
  onCancelDelete,
  onDeleteConfirmed,
}: {
  project: ProjectFile
  capture: PendingCapture
  npcNames: readonly string[]
  armed: boolean
  onArm: () => void
  mode: ListMode
  onRequestDelete: () => void
  onCancelDelete: () => void
  onDeleteConfirmed: () => void
}): ReactElement {
  const firstMedium = capture.media[0] ?? null
  // The most recently recorded other capture — offered as a one-click carry-over, exactly the
  // way a freshly placed dialogue offers the previous line's tags. Gated on there being
  // something in it worth copying, not on the capture being otherwise untouched: unlike a fresh
  // dialogue, a capture always already carries a line and a picture by the time it exists here.
  const previous = previousRecordFor(project.pendingCaptures, capture.id)
  const previousHasSomething =
    previous !== null && (previous.npcName.trim() !== '' || previous.relevance.length > 0)

  return (
    <div className="pending-capture-list__row" data-armed={armed ? 'true' : undefined}>
      <div className="pending-capture-list__summary">
        <div className="pending-capture-list__thumb">
          {firstMedium === null ? (
            <span className="pending-capture-list__no-picture">No picture</span>
          ) : (
            <MediaView media={firstMedium} label="First picture of this conversation" fit="fill" />
          )}
        </div>
        <div className="pending-capture-list__text">
          <p className="pending-capture-list__line">
            {capture.text.trim() === '' ? 'No line yet' : capture.text}
          </p>
          <p className="pending-capture-list__spoken-at">{toLocalDateTimeValue(capture.spokenAt)}</p>
        </div>
      </div>

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
        {mode.kind === 'confirming-delete' ? (
          <span className="pending-capture-list__confirm" role="alert">
            Delete this capture and its pictures?
            <button type="button" className="button button--danger" onClick={onDeleteConfirmed}>
              Delete
            </button>
            <button type="button" className="button" onClick={onCancelDelete}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="button" onClick={onRequestDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

import type { DragEvent as ReactDragEvent, ReactElement } from 'react'
import { useEffect, useId, useMemo, useState } from 'react'
import { CaptureBar } from '../capture/CaptureBar.tsx'
import { DIALOGUE_MEDIA_ACCEPT, importDialogueMedia } from '../media/import-media.ts'
import { MediaView } from '../media/MediaView.tsx'
import { zoneHueStyle } from '../map/zone-style.ts'
import { dispatch } from '../project/store.ts'
import { DialogueQuestLinks } from '../quest/DialogueQuestLinks.tsx'
import type { Dialogue, DialogueMedia, ProjectFile, Zone } from '../project/types.ts'
import { deleteMediaFile, describeError } from '../storage/project-directory.ts'
import { DialogueForm } from './DialogueForm.tsx'
import './DialoguePanel.css'

/**
 * The panel's own transient state. Not the store's: an import in flight is UI, and a warning
 * about a large file is advice about one interaction, not a property of the document.
 */
type ImportState =
  | { kind: 'idle' }
  /** `done` files of `total` are already in the document — a batch reports where it is. */
  | { kind: 'importing'; done: number; total: number }
  /** The import succeeded; the message is advice, not an error. */
  | { kind: 'warned'; message: string }
  | { kind: 'failed'; message: string }

/**
 * The detail view for the selected dialogue. Rendering it at all *is* "open" — the parent
 * owns the selection, so closing on deselect needs no state here.
 *
 * A sibling panel rather than an overlay on the canvas: the map stays visible and pannable
 * while a line is being written, which is the whole point of logging dialogue in place.
 */
export function DialoguePanel({
  project,
  dialogue,
  locations,
  onClose,
}: {
  project: ProjectFile
  dialogue: Dialogue
  /**
   * The zones this dialogue's pin falls inside, most specific first — derived by the caller
   * from the geometry, never read off the dialogue, which stores no zone at all.
   */
  locations: readonly Zone[]
  /** Must be stable — the Escape listener below depends on it. */
  onClose: () => void
}): ReactElement {
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const [dropTarget, setDropTarget] = useState(false)
  const pickerId = useId()

  // Bound on `window`, not on the panel: the selected pin keeps focus after a click, and an
  // Escape aimed at "close this" would otherwise have to be pressed inside the panel first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // A warning or an error belongs to the import that produced it, and would otherwise hang
  // over whichever dialogue the user selected next.
  const dialogueId = dialogue.id
  useEffect(() => {
    setImportState({ kind: 'idle' })
    setDropTarget(false)
  }, [dialogueId])

  const npcNames = useMemo(() => npcNamesIn(project.dialogues), [project.dialogues])
  const map = project.maps.find((candidate) => candidate.id === dialogue.mapId) ?? null

  /**
   * One file after the next rather than in parallel: the list order *is* the drop order, and
   * concurrent probes would append in whatever order the decoder finished in. A file that fails
   * is named and skipped — abandoning the rest of a five-frame drop because frame three was a
   * PDF would lose four good pictures.
   */
  async function importFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) return
    const failures: string[] = []
    const warnings: string[] = []

    for (const [index, file] of files.entries()) {
      setImportState({ kind: 'importing', done: index, total: files.length })
      try {
        const { media, warning } = await importDialogueMedia(dialogue.id, file)
        dispatch({ kind: 'dialogue/media-added', dialogueId: dialogue.id, media })
        if (warning !== null) warnings.push(`${file.name}: ${warning}`)
      } catch (error) {
        failures.push(`${file.name}: ${describeError(error)}`)
      }
    }

    setImportState(batchOutcome(files.length, failures, warnings))
  }

  async function removeMedium(medium: DialogueMedia): Promise<void> {
    dispatch({ kind: 'dialogue/media-removed', dialogueId: dialogue.id, mediaId: medium.id })
    setImportState({ kind: 'idle' })
    // After the dispatch nothing in the document names the file, so it would sit in media/
    // forever, invisible from inside the app. A file that resists deletion is dead weight
    // there, not a broken project — reported, never surfaced as app state.
    try {
      await deleteMediaFile(medium.file.fileName)
    } catch (error) {
      console.error('Could not delete media file', error)
    }
  }

  function moveMedium(medium: DialogueMedia, toIndex: number): void {
    dispatch({
      kind: 'dialogue/media-reordered',
      dialogueId: dialogue.id,
      mediaId: medium.id,
      toIndex,
    })
  }

  function onDrop(event: ReactDragEvent<HTMLElement>): void {
    event.preventDefault()
    setDropTarget(false)
    void importFiles([...event.dataTransfer.files])
  }

  return (
    <aside
      className="dialogue-panel"
      aria-label="Dialogue"
      data-drop-target={dropTarget ? 'true' : undefined}
      // preventDefault on dragover is what marks the panel as a drop target at all; without
      // it the browser navigates to the dropped file and the app is simply gone.
      onDragOver={(event) => {
        event.preventDefault()
        setDropTarget(true)
      }}
      // Dragging across a child fires dragleave on the parent, so the pointer is only really
      // gone when it entered something outside the panel — or nothing at all.
      onDragLeave={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setDropTarget(false)
      }}
      onDrop={onDrop}
    >
      <header className="dialogue-panel__header">
        <h2 className="dialogue-panel__title">Dialogue</h2>
        <button type="button" className="dialogue-panel__button" onClick={onClose}>
          Close
        </button>
      </header>
      {/* The map association is not editable — a dialogue belongs to the map it was pinned
          onto, and moving it between maps would strand its map-local position. */}
      <p className="dialogue-panel__map">on {map === null ? 'an unknown map' : map.name}</p>

      {/* Not editable, and not stored: where a dialogue happened is decided by where its pin
          sits, so moving either the pin or the zone changes this line with no write here. */}
      <p className="dialogue-panel__location">
        {locations.length === 0 ? (
          <span className="dialogue-panel__nowhere">Outside any zone</span>
        ) : (
          locations.map((zone) => (
            <span key={zone.id} className="dialogue-panel__zone" style={zoneHueStyle(zone.hue)}>
              {zone.name}
            </span>
          ))
        )}
      </p>

      <DialogueForm dialogue={dialogue} npcNames={npcNames} />

      <section className="dialogue-media">
        <h3 className="dialogue-form__legend">Media</h3>

        {/* An ordered list because the order is the content: the first entry is what the pin
            wears. Position is moved one step at a time rather than dragged — a drag inside a
            panel that is itself a drop target for files would have to fight it for the gesture. */}
        {dialogue.media.length > 0 && (
          <ol className="dialogue-media__list">
            {dialogue.media.map((medium, index) => (
              <li key={medium.id} className="dialogue-media__item">
                <MediaView media={medium} label={dialogue.npcName || 'Dialogue media'} />
                <p className="dialogue-media__position">
                  {index === 0 ? 'First — the pin shows this one' : `Picture ${index + 1}`}
                </p>
                <div className="dialogue-media__controls">
                  <button
                    type="button"
                    className="dialogue-panel__button"
                    disabled={index === 0}
                    onClick={() => moveMedium(medium, index - 1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="dialogue-panel__button"
                    disabled={index === dialogue.media.length - 1}
                    onClick={() => moveMedium(medium, index + 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="dialogue-panel__button"
                    onClick={() => void removeMedium(medium)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* A styled `<label>` driving a hidden input, as in MapImportButton: a file input
            cannot be restyled, and a button would need a ref plus a synthetic click. */}
        <label
          className="dialogue-media__label"
          htmlFor={pickerId}
          aria-disabled={importState.kind === 'importing'}
        >
          {importState.kind === 'importing'
            ? importingLabel(importState.done, importState.total)
            : 'Add images, gifs or clips'}
        </label>
        <input
          id={pickerId}
          className="dialogue-media__input"
          type="file"
          multiple
          accept={DIALOGUE_MEDIA_ACCEPT}
          disabled={importState.kind === 'importing'}
          onChange={(event) => {
            const input = event.target
            const files = [...(input.files ?? [])]
            // Clearing is what lets the same file be picked twice in a row — otherwise the
            // second pick is not a change and fires no event at all.
            input.value = ''
            void importFiles(files)
          }}
        />
        <p className="dialogue-media__hint">
          …or drop files anywhere on this panel. They are added in the order they are dropped.
        </p>

        {importState.kind === 'warned' && (
          <p className="dialogue-media__warning" role="status">
            {importState.message}
          </p>
        )}
        {importState.kind === 'failed' && (
          <p className="dialogue-media__error" role="alert">
            {importState.message}
          </p>
        )}
      </section>

      {/* Below the media it will eventually feed: the connection is a session-long setup step,
          not something touched per dialogue, so it must not push the line's own fields down. */}
      <CaptureBar profiles={project.captureProfiles} />

      <DialogueQuestLinks dialogue={dialogue} quests={project.quests} />
    </aside>
  )
}

/** Silent about the count for a single file, so the common case reads as it always did. */
function importingLabel(done: number, total: number): string {
  return total === 1 ? 'Importing…' : `Importing ${done + 1} of ${total}…`
}

/**
 * What a finished batch leaves on screen. A failure outranks a size warning: the warning is
 * advice about a file that *did* import, and the panel has one message to give.
 */
function batchOutcome(
  total: number,
  failures: readonly string[],
  warnings: readonly string[],
): ImportState {
  if (failures.length > 0) {
    const imported = total - failures.length
    // Named counts, because "one of these five was rejected" is invisible in a list that
    // simply came out shorter than the drop.
    const prefix = imported === 0 ? '' : `${imported} of ${total} imported. `
    return { kind: 'failed', message: `${prefix}${failures.join(' ')}` }
  }
  if (warnings.length > 0) return { kind: 'warned', message: warnings.join(' ') }
  return { kind: 'idle' }
}

/** Every NPC name in the project, deduplicated, blanks dropped, in locale order. */
function npcNamesIn(dialogues: readonly Dialogue[]): string[] {
  const names = new Set<string>()
  for (const dialogue of dialogues) {
    const trimmed = dialogue.npcName.trim()
    if (trimmed !== '') names.add(trimmed)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

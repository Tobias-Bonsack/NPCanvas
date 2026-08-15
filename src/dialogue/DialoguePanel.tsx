import type { DragEvent as ReactDragEvent, ReactElement } from 'react'
import { useEffect, useId, useMemo, useState } from 'react'
import { DIALOGUE_MEDIA_ACCEPT, importDialogueMedia } from '../media/import-media.ts'
import { MediaView } from '../media/MediaView.tsx'
import { zoneHueStyle } from '../map/zone-style.ts'
import { dispatch } from '../project/store.ts'
import { DialogueQuestLinks } from '../quest/DialogueQuestLinks.tsx'
import type { Dialogue, DialogueContent, ProjectFile, Zone } from '../project/types.ts'
import { deleteMediaFile, describeError } from '../storage/project-directory.ts'
import { DialogueForm } from './DialogueForm.tsx'
import './DialoguePanel.css'

/**
 * The panel's own transient state. Not the store's: an import in flight is UI, and a warning
 * about a large file is advice about one interaction, not a property of the document.
 */
type ImportState =
  | { kind: 'idle' }
  | { kind: 'importing' }
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

  async function importFile(file: File): Promise<void> {
    // Captured before the dispatch: afterwards nothing in the document names the old file,
    // and it would sit in media/ forever, invisible from inside the app.
    const replaced = dialogue.content
    setImportState({ kind: 'importing' })
    try {
      const { content, warning } = await importDialogueMedia(dialogue.id, file)
      dispatch({ kind: 'dialogue/content-set', dialogueId: dialogue.id, content })
      setImportState(warning === null ? { kind: 'idle' } : { kind: 'warned', message: warning })
      await deleteOrphan(replaced, content)
    } catch (error) {
      setImportState({ kind: 'failed', message: describeError(error) })
    }
  }

  async function clearMedia(): Promise<void> {
    const replaced = dialogue.content
    const content: DialogueContent = { kind: 'text', text: '' }
    dispatch({ kind: 'dialogue/content-set', dialogueId: dialogue.id, content })
    setImportState({ kind: 'idle' })
    await deleteOrphan(replaced, content)
  }

  function onDrop(event: ReactDragEvent<HTMLElement>): void {
    event.preventDefault()
    setDropTarget(false)
    const file = event.dataTransfer.files.item(0)
    if (file !== null) void importFile(file)
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

        {dialogue.content.kind !== 'text' && (
          <>
            <MediaView content={dialogue.content} label={dialogue.npcName || 'Dialogue media'} />
            <button
              type="button"
              className="dialogue-panel__button"
              onClick={() => void clearMedia()}
            >
              Remove media
            </button>
          </>
        )}

        {/* A styled `<label>` driving a hidden input, as in MapImportButton: a file input
            cannot be restyled, and a button would need a ref plus a synthetic click. */}
        <label
          className="dialogue-media__label"
          htmlFor={pickerId}
          aria-disabled={importState.kind === 'importing'}
        >
          {importState.kind === 'importing'
            ? 'Importing…'
            : dialogue.content.kind === 'text'
              ? 'Add image, gif or clip'
              : 'Replace media'}
        </label>
        <input
          id={pickerId}
          className="dialogue-media__input"
          type="file"
          accept={DIALOGUE_MEDIA_ACCEPT}
          disabled={importState.kind === 'importing'}
          onChange={(event) => {
            const input = event.target
            const file = input.files?.[0]
            // Clearing is what lets the same file be picked twice in a row — otherwise the
            // second pick is not a change and fires no event at all.
            input.value = ''
            if (file !== undefined) void importFile(file)
          }}
        />
        <p className="dialogue-media__hint">…or drop a file anywhere on this panel.</p>

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

      <DialogueQuestLinks dialogue={dialogue} quests={project.quests} />
    </aside>
  )
}

/**
 * Removes the file the replaced content owned, once nothing references it.
 *
 * Not unconditional: re-importing the same *kind* writes the same `<dialogueId>.<ext>` in
 * place, and deleting it afterwards would take the new file with it. The document is already
 * correct either way, so a file that resists deletion is dead weight in `media/`, not a
 * broken project — reported, never surfaced as app state.
 */
async function deleteOrphan(replaced: DialogueContent, next: DialogueContent): Promise<void> {
  if (replaced.kind === 'text') return
  if (next.kind !== 'text' && next.file.fileName === replaced.file.fileName) return
  try {
    await deleteMediaFile(replaced.file.fileName)
  } catch (error) {
    console.error('Could not delete media file', error)
  }
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

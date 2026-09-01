import type { DragEvent as ReactDragEvent, ReactElement } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { formatRoute } from '../app/route.ts'
import { GlyphLearner } from '../capture/GlyphLearner.tsx'
import { DIALOGUE_MEDIA_ACCEPT } from '../media/import-media.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { resolveGalleryIndex } from '../media/gallery-index.ts'
import { MediaGallery } from '../media/MediaGallery.tsx'
import { ZoneChips } from '../insights/ZoneChips.tsx'
import { SidePanel } from '../map/SidePanel.tsx'
import { dispatch } from '../project/store.ts'
import { formatSpokenAt } from '../dialogue-row/dialogue-summary.ts'
import { DialogueQuestLinks } from '../quest/DialogueQuestLinks.tsx'
import { DialogueReferences } from './DialogueReferences.tsx'
import { subsetByTimeAsc } from './dialogue-order.ts'
import type {
  Dialogue,
  DialogueId,
  DialogueMedia,
  MediaId,
  ProjectFile,
  Zone,
  ZoneId,
} from '../project/types.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { DialogueForm } from './DialogueForm.tsx'
import { npcNamesIn, previousRecordFor } from './recency.ts'
import type { ImportState } from './use-media-import.ts'
import { importingLabel, useMediaImport } from './use-media-import.ts'
import type { CaptureApi } from './use-capture.ts'
import { CAPTURE_SHORTCUT, useCapture } from './use-capture.ts'
import './DialoguePanel.css'

// Rendering this at all *is* "open" — the parent owns the selection, so closing on deselect
// needs no state here.
export function DialoguePanel({
  project,
  dialogue,
  locations,
  zonesById,
  zoneIndex,
  onClose,
  autoFocusNpc,
  onAutoFocusConsumed,
  openedFromPin,
  width,
  onWidthChange,
  measureAvailableWidth,
  pickingReference,
  onStartPickReference,
  onCancelPickReference,
}: {
  project: ProjectFile
  dialogue: Dialogue
  locations: readonly Zone[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  /** Must be stable — the Escape listener below depends on it. */
  onClose: () => void
  autoFocusNpc: boolean
  onAutoFocusConsumed: () => void
  /** Whether a pin (already self-focused) opened this, vs. a link/search/cold-load that didn't. */
  openedFromPin: boolean
  width: number | null
  onWidthChange: (width: number) => void
  measureAvailableWidth: () => number
  /** True while the canvas is waiting for a click to resolve this dialogue's own reference pick. */
  pickingReference: boolean
  onStartPickReference: (dialogueId: DialogueId) => void
  onCancelPickReference: () => void
}): ReactElement {
  const [dropTarget, setDropTarget] = useState(false)
  // An id, not an index, so a reorder keeps that picture on screen rather than whatever slid
  // into its place. null is the first frame — see resolveGalleryIndex.
  const [currentMediaId, setCurrentMediaId] = useState<MediaId | null>(null)
  const pickerId = useId()
  const asideRef = useRef<HTMLElement>(null)
  // Filled by DialogueForm. The line field is a draft flushed to the store on blur/idle, and a
  // capture appends to the store's text, so Ctrl+Enter must flush the draft first.
  const flushDraft = useRef<(() => void) | null>(null)
  // Mirrors SidePanel's own resize state — a resize gesture holds Escape for itself, so the
  // close listener below must stand down while one is in progress.
  const [resizing, setResizing] = useState(false)

  const dialogueId = dialogue.id
  const { importState, importFiles, resetImport } = useMediaImport(dialogueId)
  const { captureState, setCaptureState, busy, blocker, learning, capture, write, onGlyphsLearned } =
    useCapture(project, dialogueId, dialogue, flushDraft)

  // Bound on window, not the panel — the selected pin keeps focus after a click. Stood down
  // while the learner is up or a resize is in flight, so one Escape can't both abandon that
  // gesture and close the panel; typing is exempt so it never loses a draft.
  useEffect(() => {
    if (learning || resizing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (isTextFieldFocused()) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, learning, resizing])

  // Frozen at mount: this asks "how did this open happen", never "how do current props say so".
  const openedFromPinAtMount = useRef(openedFromPin)
  const autoFocusNpcAtMount = useRef(autoFocusNpc)

  // Focus moves into the panel on a "real" open (not a pin click, which self-focuses; not a
  // fresh placement, whose NPC field claims it) and is restored to whatever had it on close.
  useEffect(() => {
    const trigger = document.activeElement
    if (!openedFromPinAtMount.current && !autoFocusNpcAtMount.current) {
      asideRef.current?.focus({ preventScroll: true })
    }
    return () => {
      if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true })
    }
  }, [])

  // Import/capture state reset themselves on this same dependency in their own hooks.
  useEffect(() => {
    setDropTarget(false)
    setCurrentMediaId(null)
  }, [dialogueId])

  const npcNames = useMemo(() => npcNamesIn(project.dialogues), [project.dialogues])
  const map = project.maps.find((candidate) => candidate.id === dialogue.mapId) ?? null
  // One-click carry-over for a freshly placed dialogue — most lines in a row share a relevance.
  const previousRelevance = useMemo(
    () => previousRecordFor(project.dialogues, dialogue.id)?.relevance ?? [],
    [project.dialogues, dialogue.id],
  )

  function onDrop(event: ReactDragEvent<HTMLElement>): void {
    event.preventDefault()
    setDropTarget(false)
    void importFiles([...event.dataTransfer.files])
  }

  return (
    <SidePanel
      panelRef={asideRef}
      className="dialogue-panel"
      ariaLabel="Dialogue"
      resizerLabel="Dialogue panel width"
      width={width}
      onWidthChange={onWidthChange}
      measureAvailableWidth={measureAvailableWidth}
      onResizingChange={setResizing}
      dropTarget={dropTarget}
      onDragOver={(event) => {
        event.preventDefault()
        setDropTarget(true)
      }}
      // Dragging across a child fires dragleave on the parent too, so only leave the panel
      // when the pointer enters something outside it.
      onDragLeave={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setDropTarget(false)
      }}
      onDrop={onDrop}
    >
      <>
        <header className="dialogue-panel__header">
          <h2 className="panel-title">Dialogue</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="dialogue-panel__map hint-text">on {map === null ? 'an unknown map' : map.name}</p>

        {/* Derived, not stored — moving the pin or the zone changes this with no write here. */}
        <p className="dialogue-panel__location">
          <ZoneChips zones={locations} nowhereClassName="dialogue-panel__nowhere" />
        </p>

        {/* Keyed on the dialogue: unmounting on a pin switch is what flushes a half-typed line. */}
        <DialogueForm
          key={dialogueId}
          dialogue={dialogue}
          relevanceTags={project.relevanceTags}
          npcNames={npcNames}
          flushRef={flushDraft}
          autoFocusNpc={autoFocusNpc}
          onAutoFocusConsumed={onAutoFocusConsumed}
          previousRelevance={previousRelevance}
        />

        <DialogueMediaSection
          dialogue={dialogue}
          pickerId={pickerId}
          currentMediaId={currentMediaId}
          onSelectMedia={setCurrentMediaId}
          importState={importState}
          importFiles={importFiles}
          resetImport={resetImport}
          captureState={captureState}
          busy={busy}
          blocker={blocker}
          capture={capture}
        />

        <MergeIntoThisLine dialogue={dialogue} dialogues={project.dialogues} />

        <DialogueReferences
          dialogue={dialogue}
          dialogues={project.dialogues}
          zonesById={zonesById}
          zoneIndex={zoneIndex}
          picking={pickingReference}
          onStartPick={onStartPickReference}
          onCancelPick={onCancelPickReference}
        />

        <DialogueQuestLinks dialogue={dialogue} quests={project.quests} />

        {/* Discard, keep the picture only, or confirm the learned glyphs — nothing is written to
            media/ until confirmed, so discarding costs one setState. */}
        {captureState.kind === 'learning' && (
          <GlyphLearner
            tiles={captureState.tiles}
            cancelLabel="Discard the capture"
            onCancel={() =>
              setCaptureState({
                kind: 'done',
                message: 'Discarded. No picture and no line were written.',
              })
            }
            keepPicture={{
              label: 'Keep the picture only',
              onKeep: () => void write(captureState.frame, null),
            }}
            onConfirm={(learned) =>
              onGlyphsLearned(
                captureState.profile,
                captureState.glyphs,
                captureState.frame,
                learned,
              )
            }
          />
        )}
      </>
    </SidePanel>
  )
}

function DialogueMediaSection({
  dialogue,
  pickerId,
  currentMediaId,
  onSelectMedia,
  importState,
  importFiles,
  resetImport,
  captureState,
  busy,
  blocker,
  capture,
}: {
  dialogue: Dialogue
  pickerId: string
  currentMediaId: MediaId | null
  onSelectMedia: (id: MediaId | null) => void
  importState: ImportState
  importFiles: (files: readonly File[]) => Promise<void>
  resetImport: () => void
  captureState: CaptureApi['captureState']
  busy: boolean
  blocker: string | null
  capture: () => Promise<void>
}): ReactElement {
  // Resolved on every render, not stored — an index would go stale the moment the list reorders.
  const currentIndex = resolveGalleryIndex(dialogue.media, currentMediaId)
  const currentMedium = dialogue.media[currentIndex] ?? null

  async function removeMedium(medium: DialogueMedia, index: number): Promise<void> {
    const neighbour = dialogue.media[index + 1] ?? dialogue.media[index - 1] ?? null
    onSelectMedia(neighbour?.id ?? null)
    dispatch({ kind: 'dialogue/media-removed', dialogueId: dialogue.id, mediaId: medium.id })
    resetImport()
    // Otherwise nothing in the document names the file and it sits in media/ forever.
    await discardMediaFile(medium.file.fileName)
  }

  function moveMedium(medium: DialogueMedia, toIndex: number): void {
    // Pinned by id before the list moves under it — otherwise a frame moved off position 0
    // would leave currentMediaId at null, which resolves to whatever took its place.
    onSelectMedia(medium.id)
    dispatch({
      kind: 'dialogue/media-reordered',
      dialogueId: dialogue.id,
      mediaId: medium.id,
      toIndex,
    })
  }

  return (
    <section className="dialogue-media dialogue-panel__section">
      <h3 className="micro-label">Media</h3>

      {currentMedium !== null && (
        <>
          <MediaGallery
            media={dialogue.media}
            label={dialogue.npcName || 'Dialogue media'}
            selectedId={currentMediaId}
            onSelect={onSelectMedia}
          />
          {currentIndex === 0 && (
            <p className="dialogue-media__first">First — the pin shows this one</p>
          )}
          <div className="dialogue-media__controls">
            <button
              type="button"
              className="button"
              disabled={currentIndex === 0}
              onClick={() => moveMedium(currentMedium, currentIndex - 1)}
            >
              Move earlier
            </button>
            <button
              type="button"
              className="button"
              disabled={currentIndex === dialogue.media.length - 1}
              onClick={() => moveMedium(currentMedium, currentIndex + 1)}
            >
              Move later
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void removeMedium(currentMedium, currentIndex)}
            >
              Remove
            </button>
          </div>
        </>
      )}

      <div className="dialogue-media__actions">
        {/* A styled label driving a hidden input — a file input can't be restyled directly. */}
        <label
          className="button--primary dialogue-media__label"
          htmlFor={pickerId}
          // Style hook only — the real disabled state lives on the input below.
          data-importing={importState.kind === 'importing' ? 'true' : undefined}
        >
          {importState.kind === 'importing'
            ? importingLabel(importState.done, importState.total)
            : 'Add images, gifs or clips'}
        </label>
        <button
          type="button"
          className="dialogue-media__capture button"
          disabled={blocker !== null || busy}
          title={
            blocker ??
            `Capture the console screen, attach it, and append what the text box says — ${CAPTURE_SHORTCUT}`
          }
          onClick={() => void capture()}
        >
          {captureState.kind === 'capturing'
            ? 'Capturing…'
            : `Capture the screen · ${CAPTURE_SHORTCUT}`}
        </button>
      </div>
      <input
        id={pickerId}
        className="visually-hidden dialogue-media__input"
        type="file"
        multiple
        accept={DIALOGUE_MEDIA_ACCEPT}
        disabled={importState.kind === 'importing'}
        onChange={(event) => {
          const input = event.target
          const files = [...(input.files ?? [])]
          // Lets the same file be picked twice in a row — otherwise that pick fires no event.
          input.value = ''
          void importFiles(files)
        }}
      />
      <Disclosure>
        <p className="dialogue-media__hint hint-text">
          …or drop files anywhere on this panel. They are added in the order they are dropped.
        </p>
      </Disclosure>

      {blocker !== null && (
        <p className="dialogue-media__hint hint-text" role="status">
          <a href={formatRoute({ kind: 'settings' })}>Finish capture setup in Settings</a>
        </p>
      )}
      {captureState.kind === 'done' && (
        <p className="dialogue-media__capture-note hint-text" role="status">
          {captureState.message}
        </p>
      )}
      {captureState.kind === 'failed' && (
        <p className="dialogue-media__error hint-text" role="alert">
          {captureState.message}
        </p>
      )}

      {importState.kind === 'warned' && (
        <p className="dialogue-media__warning hint-text" role="status">
          {importState.message}
        </p>
      )}
      {importState.kind === 'failed' && (
        <p className="dialogue-media__error hint-text" role="alert">
          {importState.message}
        </p>
      )}
    </section>
  )
}

// Offered only against other lines of the same NPC — a merge across names is more likely a
// mis-click than intent, and the watcher cutting one encounter into three always keeps one name.
// No confirmation: a merge is one undo step.
function MergeIntoThisLine({
  dialogue,
  dialogues,
}: {
  dialogue: Dialogue
  dialogues: readonly Dialogue[]
}): ReactElement | null {
  const [chosen, setChosen] = useState<DialogueId | ''>('')
  const selectId = useId()
  const name = dialogue.npcName.trim()
  const others = subsetByTimeAsc(
    dialogues.filter(
      (other) => other.id !== dialogue.id && other.npcName.trim() === name && name !== '',
    ),
    dialogues,
  )

  if (others.length === 0) return null
  const target = others.find((other) => other.id === chosen) ?? null

  return (
    <section className="dialogue-merge">
      <h3 className="micro-label">Merge</h3>
      <label className="visually-hidden" htmlFor={selectId}>
        Another line by {name}
      </label>
      <div className="dialogue-merge__controls">
        <select
          id={selectId}
          className="dialogue-merge__select"
          value={chosen}
          onChange={(event) => setChosen(event.target.value as DialogueId | '')}
        >
          <option value="">Another line by {name}…</option>
          {others.map((other) => (
            <option key={other.id} value={other.id}>
              {mergeOptionLabel(other)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button"
          disabled={target === null}
          title="Join that line onto the end of this one. Its pictures come with it, and its pin goes."
          onClick={() => {
            if (target === null) return
            setChosen('')
            dispatch({ kind: 'dialogue/merged', intoId: dialogue.id, fromId: target.id })
          }}
        >
          Merge into this line
        </button>
      </div>
      <Disclosure>
        <p className="dialogue-merge__hint hint-text">
          The other line is appended to this one, its pictures after this one's, and its pin
          disappears. This line keeps its own place and name; the earlier of the two times is kept.
          Any quest that named the other line names this one afterwards. One undo puts it back.
        </p>
      </Disclosure>
    </section>
  )
}

function mergeOptionLabel(dialogue: Dialogue): string {
  const said = dialogue.text.trim()
  const shown = said.length > 60 ? `${said.slice(0, 60)}…` : said
  const when = formatSpokenAt(dialogue.spokenAt)
  if (shown !== '') return `${when} — ${shown}`
  return `${when} — ${dialogue.media.length === 1 ? '1 picture' : `${dialogue.media.length} pictures`}`
}


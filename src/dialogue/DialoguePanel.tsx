import type { CSSProperties, DragEvent as ReactDragEvent, ReactElement } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { formatRoute } from '../app/route.ts'
import { GlyphLearner } from '../capture/GlyphLearner.tsx'
import { DIALOGUE_MEDIA_ACCEPT } from '../media/import-media.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { resolveGalleryIndex } from '../media/gallery-index.ts'
import { MediaGallery } from '../media/MediaGallery.tsx'
import { zoneHueStyle } from '../map/zone-style.ts'
import { dispatch } from '../project/store.ts'
import { formatSpokenAt } from '../dialogue-row/dialogue-summary.ts'
import { DialogueQuestLinks } from '../quest/DialogueQuestLinks.tsx'
import { subsetByTimeAsc } from './dialogue-order.ts'
import type {
  Dialogue,
  DialogueId,
  DialogueMedia,
  MediaId,
  ProjectFile,
  Zone,
} from '../project/types.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { DialogueForm } from './DialogueForm.tsx'
import { MIN_PANEL_WIDTH } from './panel-width.ts'
import { npcNamesIn, previousRecordFor } from './recency.ts'
import type { ImportState } from './use-media-import.ts'
import { importingLabel, useMediaImport } from './use-media-import.ts'
import type { CaptureApi } from './use-capture.ts'
import { CAPTURE_SHORTCUT, useCapture } from './use-capture.ts'
import { usePanelResize } from './use-panel-resize.ts'
import './DialoguePanel.css'

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
  autoFocusNpc,
  onAutoFocusConsumed,
  openedFromPin,
  width,
  onWidthChange,
  measureAvailableWidth,
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
  /** This dialogue was just placed, and its NPC field — not its pin — is owed the focus. */
  autoFocusNpc: boolean
  onAutoFocusConsumed: () => void
  /**
   * Whether this open is the direct result of a pointerup on a pin — see `PinLayer`'s
   * `onPinSelected`. That pin has already focused itself by the time this mounts, so the panel
   * must not steal it back; every other way in (a link from the quest board or Insights, the
   * search palette, a cold load of `?dialogue=<id>`) leaves focus wherever it was before the
   * click, which is not necessarily anywhere useful — so the panel claims it instead. Read once,
   * at mount, in the effect below: which pin was last clicked cannot un-happen for a dialogue
   * that stays selected, but a *fresh* open only ever happens once per mount.
   */
  openedFromPin: boolean
  /** The dragged width in CSS pixels, or `null` for whatever the stylesheet gives — see `CanvasViewState`. */
  width: number | null
  onWidthChange: (width: number) => void
  /** The width the panel and the canvas share, measured now — never a number cached at mount. */
  measureAvailableWidth: () => number
}): ReactElement {
  const [dropTarget, setDropTarget] = useState(false)
  // Which frame the gallery is showing — an id, never an index, so a reorder keeps *that*
  // picture on screen rather than whatever slid into its place. `null` is the first frame; see
  // `resolveGalleryIndex`.
  const [currentMediaId, setCurrentMediaId] = useState<MediaId | null>(null)
  const pickerId = useId()
  const asideRef = useRef<HTMLElement>(null)
  // Filled by `DialogueForm`. The line field is a draft that only reaches the store on blur or
  // after an idle, and a capture appends to the store's text — so Ctrl+Enter straight out of the
  // textarea has to push the draft down first, or it appends to a line the user has moved past.
  const flushDraft = useRef<(() => void) | null>(null)

  const { resizing, band, beginResize, moveResize, endResize, cancelResize, stepResize } =
    usePanelResize(asideRef, onWidthChange, measureAvailableWidth)

  const dialogueId = dialogue.id
  const { importState, importFiles, resetImport } = useMediaImport(dialogueId)
  const { captureState, setCaptureState, busy, blocker, learning, capture, write, onGlyphsLearned } =
    useCapture(project, dialogueId, dialogue, flushDraft)

  // Bound on `window`, not on the panel: the selected pin keeps focus after a click, and an
  // Escape aimed at "close this" would otherwise have to be pressed inside the panel first.
  // Stood down while the learner is up, and while a resize is in flight, so one Escape does not
  // both abandon a gesture and close the panel that was going to report what it did — the
  // resize's own listener above is the one that must see it. Typing is exempt too — a text
  // field never loses what is being typed into it just because Escape was the key pressed —
  // and an open alertdialog or the quest picker claims the key before it can bubble this far;
  // see `useAlertDialogFocus` and `DialogueQuestLinks`'s picker.
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

  // Frozen at their mount-time value, deliberately: this effect only ever asks "how did *this*
  // open happen", never "how does the current render's props describe things now".
  const openedFromPinAtMount = useRef(openedFromPin)
  const autoFocusNpcAtMount = useRef(autoFocusNpc)

  // Focus moves into the panel on a "real" open — anywhere but a pin click, which has already
  // focused itself, and anywhere but a fresh placement, whose NPC field claims it instead (see
  // `autoFocusNpc`). Whichever way it opened, the element that had focus before it is restored
  // when the panel closes — a link clicked on the quest board should hand focus back to that
  // link, not strand it on a panel that just vanished.
  useEffect(() => {
    const trigger = document.activeElement
    if (!openedFromPinAtMount.current && !autoFocusNpcAtMount.current) {
      asideRef.current?.focus({ preventScroll: true })
    }
    return () => {
      if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true })
    }
  }, [])

  // The import and capture states reset themselves on this same dependency, inside their own
  // hooks — only the selection-scoped state that belongs to the panel itself lives here.
  useEffect(() => {
    setDropTarget(false)
    setCurrentMediaId(null)
  }, [dialogueId])

  const npcNames = useMemo(() => npcNamesIn(project.dialogues), [project.dialogues])
  const map = project.maps.find((candidate) => candidate.id === dialogue.mapId) ?? null
  // What the *previous* line was tagged, offered as a one-click carry-over on a freshly placed
  // dialogue — most projects talk to the same NPC, in the same relevance, for several lines in
  // a row. `spokenAt` is the only ordering a dialogue carries; see `previousRecordFor`.
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
    <aside
      ref={asideRef}
      className="dialogue-panel"
      aria-label="Dialogue"
      // The custom property, not `width`: the two media queries in DialoguePanel.css redefine
      // the property, so an untouched panel behaves exactly as it always has and a dragged one
      // simply outranks all three declarations.
      style={width === null ? undefined : panelWidthStyle(width)}
      // Only ever a programmatic focus target — the panel's own controls are the tab stops,
      // never the `<aside>` itself when the user is tabbing normally.
      tabIndex={-1}
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
      {/* The seam between the canvas and the panel, and the only thing in here that is not
          part of the dialogue: absolutely positioned against the `<aside>` rather than laid out
          in the column below, because the column scrolls and a handle that scrolls away is
          reachable only at the top of a long panel. */}
      <div
        className="dialogue-panel__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Dialogue panel width"
        aria-valuenow={Math.round(band?.width ?? MIN_PANEL_WIDTH)}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={Math.round(band?.max ?? MIN_PANEL_WIDTH)}
        tabIndex={0}
        data-resizing={resizing ? 'true' : undefined}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={cancelResize}
        onKeyDown={stepResize}
      />
      {/* Everything the panel is about scrolls; the handle above does not. */}
      <div className="dialogue-panel__content">
        <header className="dialogue-panel__header">
          <h2 className="panel-title">Dialogue</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        {/* The map association is not editable — a dialogue belongs to the map it was pinned
            onto, and moving it between maps would strand its map-local position. */}
        <p className="dialogue-panel__map hint-text">on {map === null ? 'an unknown map' : map.name}</p>

        {/* Not editable, and not stored: where a dialogue happened is decided by where its pin
            sits, so moving either the pin or the zone changes this line with no write here. */}
        <p className="dialogue-panel__location">
          {locations.length === 0 ? (
            <span className="dialogue-panel__nowhere">Outside any zone</span>
          ) : (
            locations.map((zone) => (
              <span key={zone.id} className="hue-chip dialogue-row__zone" style={zoneHueStyle(zone.hue)}>
                {zone.name}
              </span>
            ))
          )}
        </p>

        {/* Keyed on the dialogue: switching pins must unmount the form, because unmount is what
            flushes a half-typed line into the dialogue it was typed for. */}
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

        <DialogueQuestLinks dialogue={dialogue} quests={project.quests} />
      </div>
      {/* Three ways out, because a frame the alphabet cannot read is worth all three answers. The
          picture is the record and the half that cannot be produced again once the game has
          advanced — but a frame grabbed by mistake, of a menu or through a mis-calibrated profile,
          is not, and nothing has been written to `media/` yet, so discarding costs one setState.
          Escape is the discard, as it is in both other learners: nothing this one opened over has
          been written, so the harmless reading of Escape is also the literal one. */}
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
            onKeep: () => void write(captureState.profile, captureState.frame, null),
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
    </aside>
  )
}

/**
 * The media strip: the gallery, its reorder/remove controls, the add-files control, and the
 * capture button — everything below the line field that is about a dialogue's pictures rather
 * than its text. A sibling of `MergeIntoThisLine`, for the same reason: nothing else in the panel
 * needs to read what it owns.
 *
 * `currentMediaId` is owned by `DialoguePanel` rather than here, because a dialogue switch resets
 * it in the same effect that resets `dropTarget` — see the panel's own comment there.
 */
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
  // Resolved on every render rather than stored: the list is what moved, and an index kept in
  // state would go stale the moment a frame is reordered or removed.
  const currentIndex = resolveGalleryIndex(dialogue.media, currentMediaId)
  const currentMedium = dialogue.media[currentIndex] ?? null

  /**
   * The frame that goes when the current one is removed: the one after it, or the one before it
   * at the end of the list. Chosen here rather than left to `resolveGalleryIndex`'s fallback,
   * which only knows that an id is gone, not which neighbour the reader was heading towards.
   */
  async function removeMedium(medium: DialogueMedia, index: number): Promise<void> {
    const neighbour = dialogue.media[index + 1] ?? dialogue.media[index - 1] ?? null
    onSelectMedia(neighbour?.id ?? null)
    dispatch({ kind: 'dialogue/media-removed', dialogueId: dialogue.id, mediaId: medium.id })
    resetImport()
    // After the dispatch nothing in the document names the file, so it would sit in media/
    // forever, invisible from inside the app.
    await discardMediaFile(medium.file.fileName)
  }

  function moveMedium(medium: DialogueMedia, toIndex: number): void {
    // Pinned by id before the list moves under it: without this a frame moved from position 0
    // would leave `currentMediaId` at `null`, which resolves to position 0 — the frame that
    // just took its place.
    onSelectMedia(medium.id)
    dispatch({
      kind: 'dialogue/media-reordered',
      dialogueId: dialogue.id,
      mediaId: medium.id,
      toIndex,
    })
  }

  return (
    <section className="dialogue-media">
      <h3 className="micro-label">Media</h3>

      {/* One frame at a time, paged — five stamps in a column push the form that produced
        them off screen. The reorder and remove controls sit under the gallery and act on
        whatever it is showing, which is why the selection lives here and not in it. */}
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
        {/* A styled `<label>` driving a hidden input, as in MapImportButton: a file input
            cannot be restyled, and a button would need a ref plus a synthetic click. */}
        <label
          className="button--primary dialogue-media__label"
          htmlFor={pickerId}
          // Not `aria-disabled`: that attribute means something on a widget with a role, and
          // a `<label>` has none — it conveys nothing to assistive tech and only ever styled
          // this element. The real state lives on the `<input>` below, which is genuinely
          // `disabled` and already announced as such; this is a plain style hook.
          data-importing={importState.kind === 'importing' ? 'true' : undefined}
        >
          {importState.kind === 'importing'
            ? importingLabel(importState.done, importState.total)
            : 'Add images, gifs or clips'}
        </label>
        {/* Beside the import because it is the other way a picture gets here — and the faster
            one, once the source and the profile are set up below. */}
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
          // Clearing is what lets the same file be picked twice in a row — otherwise the
          // second pick is not a change and fires no event at all.
          input.value = ''
          void importFiles(files)
        }}
      />
      <Disclosure>
        <p className="dialogue-media__hint hint-text">
          …or drop files anywhere on this panel. They are added in the order they are dropped.
        </p>
      </Disclosure>

      {/* Never disabled and silent: the button's `title` carries the full sentence naming what
          is missing. This is the short, actionable half — where to go fix it — now that the
          rig itself lives on the settings screen rather than right below this button. */}
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

/**
 * Two records that were always one, joined back together.
 *
 * Offered only against **other lines of the same NPC**: a merge across two names is far more
 * likely a mis-click than an intention, and the case this exists for — the watcher having cut one
 * encounter into three — always leaves the pieces under one name. Ordered by when they were heard,
 * which is the order they would have been written in.
 *
 * No confirmation. A merge is one undo step, which is the same reason `forgetGlyph` has none.
 */
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

/** Enough of a line to pick it out of a list of one NPC's lines: when, and what it says. */
function mergeOptionLabel(dialogue: Dialogue): string {
  const said = dialogue.text.trim()
  const shown = said.length > 60 ? `${said.slice(0, 60)}…` : said
  const when = formatSpokenAt(dialogue.spokenAt)
  if (shown !== '') return `${when} — ${shown}`
  return `${when} — ${dialogue.media.length === 1 ? '1 picture' : `${dialogue.media.length} pictures`}`
}

/**
 * The dragged width as the inherited custom property `.dialogue-panel` reads. The intersection
 * type is how it reaches `style` without an `as` cast, as in `zoneHueStyle` and `mapGroupStyle`:
 * `CSSProperties` alone has no index signature for `--*`.
 */
function panelWidthStyle(
  width: number,
): CSSProperties & Record<'--dialogue-panel-width', string> {
  return { '--dialogue-panel-width': `${width}px` }
}



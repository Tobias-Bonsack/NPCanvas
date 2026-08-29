import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { formatRoute } from '../app/route.ts'
import { useActiveCaptureProfile } from '../capture/active-profile.ts'
import {
  captureBlocker,
  captureIntoDialogue,
  describeCapture,
  readLiveBox,
} from '../capture/capture-to-dialogue.ts'
import { useCaptureSource } from '../capture/capture-session.ts'
import { GlyphLearner } from '../capture/GlyphLearner.tsx'
import type { UnknownTile } from '../capture/glyph-matcher.ts'
import { mergeGlyphs, readTextBox } from '../capture/glyph-matcher.ts'
import { DIALOGUE_MEDIA_ACCEPT, importDialogueMedia } from '../media/import-media.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { resolveGalleryIndex } from '../media/gallery-index.ts'
import { MediaGallery } from '../media/MediaGallery.tsx'
import type { DragGesture } from '../map/drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from '../map/drag-gesture.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import { currentDialogue, dispatch } from '../project/store.ts'
import { formatSpokenAt } from '../dialogue-row/dialogue-summary.ts'
import { DialogueQuestLinks } from '../quest/DialogueQuestLinks.tsx'
import type {
  CaptureProfile,
  Dialogue,
  DialogueId,
  DialogueMedia,
  Glyph,
  MediaId,
  ProjectFile,
  Zone,
} from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { DialogueForm } from './DialogueForm.tsx'
import { MIN_CANVAS_WIDTH, MIN_PANEL_WIDTH, clampPanelWidth } from './panel-width.ts'
import { npcNamesIn, previousRecordFor } from './recency.ts'
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
 * One press of the capture button, as the panel sees it.
 *
 * `learning` holds the frame that raised the question, because the emulator has moved on by the
 * time the characters are typed in — and it is the state that makes "nothing is written until the
 * box can be read whole" true, rather than a rule the handler is trusted to follow.
 */
type CaptureState =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | {
      kind: 'learning'
      /** The capture stays with the profile it started under, whatever the bar switches to. */
      profile: CaptureProfile
      /** And with the alphabet it started under, for the same reason — including the tiles just
          typed in, which the store has not handed back yet. */
      glyphs: readonly Glyph[]
      frame: ImageData
      tiles: readonly UnknownTile[]
    }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

/**
 * What a resize gesture snapshots at pointerdown: the width the panel actually had — which may
 * have come from the stylesheet rather than from a previous drag — and the width the panel and
 * the canvas share. Both are re-measured per gesture, because the window can be resized between
 * two of them.
 */
type PanelResizeData = { startWidth: number; availableWidth: number }

/** One press of an arrow key on the handle, in CSS pixels. */
const PANEL_WIDTH_STEP = 32

/** The in-page shortcut, and the words for it — the emulator has the keyboard the rest of the time. */
const CAPTURE_KEY = 'Enter'
const CAPTURE_SHORTCUT = 'Ctrl+Enter'

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
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const [captureState, setCaptureState] = useState<CaptureState>({ kind: 'idle' })
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

  // The resize gesture's own bookkeeping lives in a ref, exactly as every other drag in this
  // repo does; only the flag the handle and the Escape listener read is state, so a pointermove
  // costs one render of this panel and nothing else.
  const resizeRef = useRef<DragGesture<PanelResizeData> | null>(null)
  const [resizing, setResizing] = useState(false)

  // What the handle announces. Measured rather than assumed, because the panel's width may come
  // from the stylesheet, from one of its two media queries, or from a drag, and the maximum
  // moves whenever the window does. Deliberately *not* what the clamp reads — a gesture measures
  // for itself at pointerdown, since a number cached here would clamp against a stale window.
  const [band, setBand] = useState<{ width: number; max: number } | null>(null)
  const measureBand = useRef<() => void>(() => {})
  // No dependency list: every render is a chance the panel changed width, and returning the
  // previous object when nothing moved is what stops the setState from looping.
  useEffect(() => {
    const measure = (): void => {
      const aside = asideRef.current
      if (aside === null) return
      const measured = aside.getBoundingClientRect().width
      const max = Math.max(MIN_PANEL_WIDTH, measureAvailableWidth() - MIN_CANVAS_WIDTH)
      setBand((prev) =>
        prev !== null && prev.width === measured && prev.max === max
          ? prev
          : { width: measured, max },
      )
    }
    measureBand.current = measure
    measure()
  })

  // A window resize moves both ends of the band without rendering anything on its own.
  useEffect(() => {
    const onResize = (): void => measureBand.current()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function beginResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    const startWidth = asideRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH
    beginDrag(resizeRef, event, { startWidth, availableWidth: measureAvailableWidth() })
  }

  // The handle is on the *left* edge, so travel to the left widens the panel — hence `-dx`.
  function moveResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const move = moveDrag(resizeRef, event)
    if (move === null) return
    if (move.started) setResizing(true)
    onWidthChange(clampPanelWidth(move.data.startWidth - move.dx, move.data.availableWidth))
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    if (commitDrag(resizeRef, event) === null) return
    setResizing(false)
  }

  /**
   * The platform withdrew the gesture, so the width goes back to the one the press started
   * from — a cancel is not a shorter pointerup. Escape mid-drag is the same terminal, and the
   * effect below is where it lands: there is no pointer event for a key press.
   */
  function cancelResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = resizeRef.current
    if (!cancelDrag(resizeRef, event)) return
    setResizing(false)
    if (gesture !== null) restoreWidth(gesture.data)
  }

  function restoreWidth(data: PanelResizeData): void {
    onWidthChange(clampPanelWidth(data.startWidth, data.availableWidth))
  }

  function stepResize(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // The separator moves the way the arrow points; the panel is to its right, so left is wider.
    const step =
      event.key === 'ArrowLeft'
        ? PANEL_WIDTH_STEP
        : event.key === 'ArrowRight'
          ? -PANEL_WIDTH_STEP
          : null
    if (step === null) return
    event.preventDefault()
    const current = asideRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH
    onWidthChange(clampPanelWidth(current + step, measureAvailableWidth()))
  }

  useEffect(() => {
    if (!resizing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const gesture = resizeRef.current
      resizeRef.current = null
      setResizing(false)
      if (gesture !== null) {
        onWidthChange(clampPanelWidth(gesture.data.startWidth, gesture.data.availableWidth))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [resizing, onWidthChange])

  const source = useCaptureSource()
  const profile = useActiveCaptureProfile(project.captureProfiles)
  const blocker = captureBlocker(source, profile)

  const busy = captureState.kind === 'capturing' || captureState.kind === 'learning'

  // Bound on `window`, not on the panel: the selected pin keeps focus after a click, and an
  // Escape aimed at "close this" would otherwise have to be pressed inside the panel first.
  // Stood down while the learner is up, and while a resize is in flight, so one Escape does not
  // both abandon a gesture and close the panel that was going to report what it did — the
  // resize's own listener above is the one that must see it. Typing is exempt too — a text
  // field never loses what is being typed into it just because Escape was the key pressed —
  // and an open alertdialog or the quest picker claims the key before it can bubble this far;
  // see `useAlertDialogFocus` and `DialogueQuestLinks`'s picker.
  const learning = captureState.kind === 'learning'
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

  // A warning or an error belongs to the import that produced it, and would otherwise hang
  // over whichever dialogue the user selected next.
  const dialogueId = dialogue.id
  useEffect(() => {
    setImportState({ kind: 'idle' })
    setCaptureState({ kind: 'idle' })
    setDropTarget(false)
    setCurrentMediaId(null)
  }, [dialogueId])

  // Resolved on every render rather than stored: the list is what moved, and an index kept in
  // state would go stale the moment a frame is reordered or removed.
  const currentIndex = resolveGalleryIndex(dialogue.media, currentMediaId)
  const currentMedium = dialogue.media[currentIndex] ?? null

  const npcNames = useMemo(() => npcNamesIn(project.dialogues), [project.dialogues])
  const map = project.maps.find((candidate) => candidate.id === dialogue.mapId) ?? null
  // What the *previous* line was tagged, offered as a one-click carry-over on a freshly placed
  // dialogue — most projects talk to the same NPC, in the same relevance, for several lines in
  // a row. `spokenAt` is the only ordering a dialogue carries; see `previousRecordFor`.
  const previousRelevance = useMemo(
    () => previousRecordFor(project.dialogues, dialogue.id)?.relevance ?? [],
    [project.dialogues, dialogue.id],
  )

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
    // Every file this batch has already put in media/. Nothing else would name them again if
    // the dialogue is deleted mid-import, and the cascade that deleted it only knew about the
    // media the document held at the time.
    const written: string[] = []

    for (const [index, file] of files.entries()) {
      setImportState({ kind: 'importing', done: index, total: files.length })
      try {
        const { media, warning } = await importDialogueMedia(dialogue.id, file)
        written.push(media.file.fileName)
        dispatch({ kind: 'dialogue/media-added', dialogueId: dialogue.id, media })
        if (warning !== null) warnings.push(`${file.name}: ${warning}`)
      } catch (error) {
        failures.push(`${file.name}: ${describeError(error)}`)
      }
      // The dispatch above is a no-op once the dialogue is gone: deleted from the canvas, or
      // cascaded away with its map, while "Importing..." was up. The reducer returning the same
      // state is silent, so without this check the panel reports success for a document that
      // never took the media, and the files sit in media/ forever, invisible from inside the app.
      if (currentDialogue(dialogue.id) === null) {
        for (const fileName of written) await discardMediaFile(fileName)
        setImportState({
          kind: 'failed',
          message: 'The dialogue was deleted while importing. Nothing was kept.',
        })
        return
      }
    }

    setImportState(batchOutcome(files.length, failures, warnings))
  }

  /**
   * One press: the frame becomes a picture on the pin and the new part of the box becomes text.
   *
   * An unreadable tile stops the chain here, before anything is written — a dialogue must never
   * end up holding a picture beside half a sentence.
   */
  async function capture(): Promise<void> {
    if (busy) return
    flushDraft.current?.()
    if (blocker !== null || profile === null) {
      setCaptureState({ kind: 'failed', message: blocker ?? 'No capture profile is active.' })
      return
    }
    setCaptureState({ kind: 'capturing' })
    try {
      const { frame, reading } = await readLiveBox(profile, project.glyphs)
      if (reading.unknown.length > 0) {
        setCaptureState({
          kind: 'learning',
          profile,
          glyphs: project.glyphs,
          frame,
          tiles: reading.unknown,
        })
        return
      }
      await write(profile, frame, reading.text)
    } catch (error) {
      setCaptureState({ kind: 'failed', message: describeError(error) })
    }
  }

  /** `transcript === null` is a box that could not be read whole: the picture is kept, the line is not. */
  async function write(
    target: CaptureProfile,
    frame: ImageData,
    transcript: string | null,
  ): Promise<void> {
    setCaptureState({ kind: 'capturing' })
    try {
      // The document as it stands now, not as this render saw it: the line field is a draft
      // that `capture` only just flushed, and a learner can stand open for minutes while the
      // panel keeps taking edits. Appending to the render's copy would undo both.
      const into = currentDialogue(dialogueId) ?? dialogue
      const result = await captureIntoDialogue(into, target, frame, transcript)
      setCaptureState({ kind: 'done', message: describeCapture(result) })
    } catch (error) {
      setCaptureState({ kind: 'failed', message: describeError(error) })
    }
  }

  function onGlyphsLearned(
    target: CaptureProfile,
    alphabet: readonly Glyph[],
    frame: ImageData,
    learned: Glyph[],
  ): void {
    dispatch({ kind: 'glyphs/learned', glyphs: learned })
    // The store's own copy arrives on the next render and the transcript is wanted now, so the
    // grown alphabet is applied here through the same merge the reducer just ran — as CaptureBar
    // does. Re-read rather than assumed complete: two glyphs learned one bit apart stay ambiguous.
    const grown = mergeGlyphs(alphabet, learned)
    const reading = readTextBox(frame, target, grown)
    if (reading.unknown.length > 0) {
      setCaptureState({ kind: 'learning', profile: target, glyphs: grown, frame, tiles: reading.unknown })
      return
    }
    void write(target, frame, reading.text)
  }

  // The handler closes over the dialogue, so it is a new function on every keystroke in the line
  // field. A ref keeps the window binding stable while the shortcut still runs the current one.
  const captureRef = useRef(capture)
  useEffect(() => {
    captureRef.current = capture
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== CAPTURE_KEY || !event.ctrlKey || event.altKey || event.shiftKey) return
      // The panel's line field is a textarea, where the default would be a newline in the very
      // text this is about to append to.
      event.preventDefault()
      void captureRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * The frame that goes when the current one is removed: the one after it, or the one before it
   * at the end of the list. Chosen here rather than left to `resolveGalleryIndex`'s fallback,
   * which only knows that an id is gone, not which neighbour the reader was heading towards.
   */
  async function removeMedium(medium: DialogueMedia, index: number): Promise<void> {
    const neighbour = dialogue.media[index + 1] ?? dialogue.media[index - 1] ?? null
    setCurrentMediaId(neighbour?.id ?? null)
    dispatch({ kind: 'dialogue/media-removed', dialogueId: dialogue.id, mediaId: medium.id })
    setImportState({ kind: 'idle' })
    // After the dispatch nothing in the document names the file, so it would sit in media/
    // forever, invisible from inside the app.
    await discardMediaFile(medium.file.fileName)
  }

  function moveMedium(medium: DialogueMedia, toIndex: number): void {
    // Pinned by id before the list moves under it: without this a frame moved from position 0
    // would leave `currentMediaId` at `null`, which resolves to position 0 — the frame that
    // just took its place.
    setCurrentMediaId(medium.id)
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
          <h2 className="dialogue-panel__title">Dialogue</h2>
          <button type="button" className="button" onClick={onClose}>
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
              onSelect={setCurrentMediaId}
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
              className="dialogue-media__capture"
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
            <p className="dialogue-media__hint">
              …or drop files anywhere on this panel. They are added in the order they are dropped.
            </p>
          </Disclosure>

          {/* Never disabled and silent: the button's `title` carries the full sentence naming what
              is missing. This is the short, actionable half — where to go fix it — now that the
              rig itself lives on the settings screen rather than right below this button. */}
          {blocker !== null && (
            <p className="dialogue-media__hint" role="status">
              <a href={formatRoute({ kind: 'settings' })}>Finish capture setup in Settings</a>
            </p>
          )}
          {captureState.kind === 'done' && (
            <p className="dialogue-media__capture-note" role="status">
              {captureState.message}
            </p>
          )}
          {captureState.kind === 'failed' && (
            <p className="dialogue-media__error" role="alert">
              {captureState.message}
            </p>
          )}

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
  const others = dialogues
    .filter((other) => other.id !== dialogue.id && other.npcName.trim() === name && name !== '')
    .sort((a, b) => a.spokenAt.localeCompare(b.spokenAt))

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
        <p className="dialogue-merge__hint">
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


import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useActiveCaptureProfile } from '../capture/active-profile.ts'
import { CaptureBar } from '../capture/CaptureBar.tsx'
import {
  captureBlocker,
  captureIntoDialogue,
  describeCapture,
  readLiveBox,
} from '../capture/capture-to-dialogue.ts'
import { useCaptureSource } from '../capture/capture-session.ts'
import type { WatchState } from '../capture/capture-watch.ts'
import {
  describeReplay,
  heldUnknownTiles,
  replayHeldFrames,
  setDraftFlush,
  startWatching,
  stopWatching,
  useHeldFrames,
  useWatchState,
  useWatching,
} from '../capture/capture-watch.ts'
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
import { DialogueQuestLinks } from '../quest/DialogueQuestLinks.tsx'
import type {
  CaptureProfile,
  Dialogue,
  DialogueMedia,
  Glyph,
  MediaId,
  ProjectFile,
  RelevanceTagId,
  Zone,
} from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { DialogueForm } from './DialogueForm.tsx'
import { MIN_CANVAS_WIDTH, MIN_PANEL_WIDTH, clampPanelWidth } from './panel-width.ts'
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
  /**
   * The same questions, asked for the watcher's whole held queue at once. No single frame: the
   * tiles are the union across all of them, and every frame is re-read on confirm.
   */
  | {
      kind: 'learning-held'
      profile: CaptureProfile
      glyphs: readonly Glyph[]
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
 * Switching the watcher on and off, as one unmodified key.
 *
 * Bare rather than a chord, and one letter rather than two, because of when it is pressed: a
 * conversation starts and ends while the hand is on the emulator's controls, so the gesture has to
 * be cheaper than reaching for the panel. `w` is free — the canvas tools own `i`, `p`, `z` and `m`,
 * and the viewport `f`, `0`, `+` and `-`.
 *
 * Unmodified letters are also exactly what an NPC name is made of, so the listener stands down for
 * a focused text field the same way `MapScreen`'s tool shortcuts do.
 */
const WATCH_KEY = 'w'
const WATCH_SHORTCUT = 'W'

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
  // Only whether the loop runs, not what it has counted: see `useWatching`. The status line below
  // is what subscribes to the rest, so a box appended does not re-render the panel around it.
  const watching = useWatching()

  // The watcher writes without anyone touching the browser, so it has to be able to push the line
  // field's draft down first — exactly as the capture button does before it appends. Registered
  // for as long as a panel is mounted, and taken back on unmount so a stale closure cannot commit
  // into a dialogue that is no longer on screen.
  useEffect(() => {
    setDraftFlush(() => flushDraft.current?.())
    return () => setDraftFlush(null)
  }, [])
  const busy = captureState.kind === 'capturing' || isLearning(captureState)

  // Bound on `window`, not on the panel: the selected pin keeps focus after a click, and an
  // Escape aimed at "close this" would otherwise have to be pressed inside the panel first.
  // Stood down while the learner is up, and while a resize is in flight, so one Escape does not
  // both abandon a gesture and close the panel that was going to report what it did — the
  // resize's own listener above is the one that must see it. Typing is exempt too — a text
  // field never loses what is being typed into it just because Escape was the key pressed —
  // and an open alertdialog or the quest picker claims the key before it can bubble this far;
  // see `useAlertDialogFocus` and `DialogueQuestLinks`'s picker.
  const learning = isLearning(captureState)
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
  // a row. `spokenAt` is the only ordering a dialogue carries; see `previousRelevanceFor`.
  const previousRelevance = useMemo(
    () => previousRelevanceFor(project.dialogues, dialogue.id),
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

  /**
   * The held queue's questions, asked once for the whole queue.
   *
   * A queue that has nothing left to ask — the alphabet grew for another reason since — replays
   * straight away rather than opening a learner with no tiles in it.
   */
  function answerHeld(): void {
    if (busy || profile === null) return
    const tiles = heldUnknownTiles(profile, project.glyphs)
    if (tiles.length === 0) {
      void replayHeld(profile, project.glyphs)
      return
    }
    setCaptureState({ kind: 'learning-held', profile, glyphs: project.glyphs, tiles })
  }

  async function replayHeld(target: CaptureProfile, alphabet: readonly Glyph[]): Promise<void> {
    setCaptureState({ kind: 'capturing' })
    try {
      setCaptureState({
        kind: 'done',
        message: describeReplay(await replayHeldFrames(target, alphabet)),
      })
    } catch (error) {
      // `replayHeldFrames` keeps a frame it could not write, so nothing is lost here — but the
      // panel must not be left reading "Capturing…" with every control disabled behind it.
      setCaptureState({ kind: 'failed', message: describeError(error) })
    }
  }

  function onHeldGlyphsLearned(
    target: CaptureProfile,
    alphabet: readonly Glyph[],
    learned: Glyph[],
  ): void {
    dispatch({ kind: 'glyphs/learned', glyphs: learned })
    // The store's own copy arrives on the next render and the frames are being re-read now, so
    // the grown alphabet is applied here through the same merge the reducer just ran — as
    // `CaptureBar` and `onGlyphsLearned` do.
    void replayHeld(target, mergeGlyphs(alphabet, learned))
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

  /**
   * The watcher's toggle, for both the button and the key.
   *
   * Stopping is unconditional: the connection can end while the loop runs, and a toggle that
   * refused to stop would leave it switched on with no way back. Starting is not — a blocker means
   * there is nothing to read, and switching on into a paused loop says the opposite of what
   * happened. Same rule as the button's `disabled`, in one place so the two cannot drift.
   */
  function toggleWatch(): void {
    if (watching) stopWatching()
    else if (blocker === null) startWatching()
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

  // Both halves change on every render — `watching` on each toggle, `blocker` whenever the
  // connection or the profile does — so the same ref pattern as `captureRef` keeps one binding.
  const toggleWatchRef = useRef(toggleWatch)
  useEffect(() => {
    toggleWatchRef.current = toggleWatch
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.toLowerCase() !== WATCH_KEY) return
      if (isTextFieldFocused()) return
      event.preventDefault()
      toggleWatchRef.current()
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
            {/* The same capture, unattended. Beside the button rather than in `CaptureBar`,
                because this is switched on and off per conversation while the bar is a
                session-long setup step. */}
            <button
              type="button"
              className="dialogue-media__watch"
              data-watching={watching ? 'true' : undefined}
              aria-pressed={watching}
              // Stopping must always be possible: the connection can end while the loop runs,
              // and a toggle that disabled itself would leave it stuck on.
              disabled={blocker !== null && !watching}
              title={
                watching
                  ? `Stop reading the text box — ${WATCH_SHORTCUT}`
                  : (blocker ??
                    `Read the text box while you play — every box that comes to rest is appended to this line, with its picture. ${WATCH_SHORTCUT}`)
              }
              onClick={toggleWatch}
            >
              {watching ? 'Stop watching' : 'Watch the text box'} · {WATCH_SHORTCUT}
            </button>
          </div>
          <WatchNote />
          <HeldNote onAnswer={answerHeld} disabled={busy || profile === null} />
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
          <p className="dialogue-media__hint">
            …or drop files anywhere on this panel. They are added in the order they are dropped.
          </p>

          {/* Never disabled and silent: the button's `title` is the same sentence, and a tooltip on
              a disabled control is not something anyone goes looking for. */}
          {blocker !== null && (
            <p className="dialogue-media__hint" role="status">
              {blocker}
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

        {/* Below the media it will eventually feed: the connection is a session-long setup step,
            not something touched per dialogue, so it must not push the line's own fields down. */}
        <CaptureBar profiles={project.captureProfiles} glyphs={project.glyphs} />

        <DialogueQuestLinks dialogue={dialogue} quests={project.quests} />
      </div>
      {/* Cancelling keeps the picture and says the text was not transcribed — the frame is the
          record, and it is the half that cannot be produced again once the game has advanced. */}
      {captureState.kind === 'learning' && (
        <GlyphLearner
          tiles={captureState.tiles}
          onCancel={() => void write(captureState.profile, captureState.frame, null)}
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
      {/* Cancelling here discards nothing at all: the held frames are still in the queue, and the
          control that opened this is still beside the capture button. */}
      {captureState.kind === 'learning-held' && (
        <GlyphLearner
          tiles={captureState.tiles}
          onCancel={() => setCaptureState({ kind: 'idle' })}
          onConfirm={(learned) =>
            onHeldGlyphsLearned(captureState.profile, captureState.glyphs, learned)
          }
        />
      )}
    </aside>
  )
}

/**
 * What the watcher is doing, in the one place that stays in view while the game runs beside it.
 *
 * Its own component with its own subscription, so a box appended re-renders this paragraph and not
 * the panel around it — and its own one-second tick, because "read 40 s ago" has to keep counting
 * while the watcher is paused and publishing nothing at all.
 */
function WatchNote(): ReactElement | null {
  const watch = useWatchState()
  const ticking = watch.kind === 'watching'
  const [, retick] = useState(0)

  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => retick((count) => count + 1), 1000)
    return () => clearInterval(timer)
  }, [ticking])

  if (watch.kind === 'off') {
    // A watcher switched off by hand says nothing; one that stopped itself has to.
    return watch.message === null ? null : (
      <p className="dialogue-media__error" role="alert">
        Watching stopped. {watch.message}
      </p>
    )
  }

  return (
    <>
      {/* No live region: this line changes every second, and a screen reader announcing the
          clock would bury the messages below it, which do carry one. */}
      <p className="dialogue-media__watch-note">{watchSummary(watch)}</p>
      {watch.paused !== null && (
        <p className="dialogue-media__hint" role="status">
          {watch.paused}
        </p>
      )}
      {watch.lastText !== null && (
        <p className="dialogue-media__watch-line" title={watch.lastText}>
          {watch.lastText}
        </p>
      )}
    </>
  )
}

/** Both learners stand in front of the panel and both block a second capture. */
function isLearning(state: CaptureState): boolean {
  return state.kind === 'learning' || state.kind === 'learning-held'
}

/**
 * The boxes the alphabet could not name, and the one control that turns them back into lines.
 *
 * Shown whether or not the watcher is still running: the queue outlives it, and the alphabet is
 * usually answered once the conversation is over. Its own subscription, like `WatchNote`.
 */
function HeldNote({
  onAnswer,
  disabled,
}: {
  onAnswer: () => void
  disabled: boolean
}): ReactElement | null {
  const held = useHeldFrames()
  if (held.waiting === 0 && held.dropped === 0) return null

  return (
    <div className="dialogue-media__held" role="status">
      <p className="dialogue-media__watch-note">
        {held.waiting === 1
          ? '1 box is waiting for the alphabet'
          : `${held.waiting} boxes are waiting for the alphabet`}
        {held.dropped > 0 &&
          ` · ${held.dropped} older ${held.dropped === 1 ? 'one was' : 'ones were'} pushed out of the queue and lost`}
      </p>
      {/* Why the line has stopped growing even though the watcher says it is reading: a box the
          alphabet cannot name holds up the boxes after it, because a held box can only ever be
          appended at the end of the line. */}
      {held.waiting > 1 && (
        <p className="dialogue-media__hint">
          The boxes after the one it could not read are waiting with it, so the line keeps its
          order.
        </p>
      )}
      {held.waiting > 0 && (
        <button type="button" className="button" disabled={disabled} onClick={onAnswer}>
          Name the tiles and write them
        </button>
      )}
    </div>
  )
}

/** The counters as one line: what has been written, what is waiting, and how long since a read. */
function watchSummary(watch: Extract<WatchState, { kind: 'watching' }>): string {
  const parts = [
    watch.appended === 1 ? '1 box appended' : `${watch.appended} boxes appended`,
    watch.repeated === 0 ? null : `${watch.repeated} said nothing new`,
    // A picture vanishing from the list is exactly the kind of thing that has to be said where it
    // happens, rather than left to be noticed.
    watch.dropped === 0
      ? null
      : `${watch.dropped} in-between ${watch.dropped === 1 ? 'picture' : 'pictures'} dropped`,
    sinceRead(watch.lastReadAt),
  ]
  return `Watching · ${parts.filter((part) => part !== null).join(' · ')}`
}

/** How long ago the last frame was read, at the resolution the watcher publishes it in. */
function sinceRead(lastReadAt: number | null): string {
  if (lastReadAt === null) return 'nothing read yet'
  const seconds = Math.max(0, Math.round((Date.now() - lastReadAt) / 1000))
  if (seconds < 2) return 'reading'
  if (seconds < 60) return `read ${seconds} s ago`
  return `read ${Math.floor(seconds / 60)} min ago`
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

/** How many of the most-recently-spoken NPCs lead the list before it falls back to alphabetical. */
const RECENT_NPC_LIMIT = 5

/**
 * Every NPC name in the project, deduplicated and blanks dropped — the most recently spoken
 * `RECENT_NPC_LIMIT` first, in that order, then everyone else in locale order. While playing,
 * the next line is usually one of the last few people talked to; alphabetical order made every
 * one of them equally far from the top.
 */
function npcNamesIn(dialogues: readonly Dialogue[]): string[] {
  const byRecency = [...dialogues].sort((a, b) => b.spokenAt.localeCompare(a.spokenAt))
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const dialogue of byRecency) {
    const trimmed = dialogue.npcName.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    ordered.push(trimmed)
  }
  const recent = ordered.slice(0, RECENT_NPC_LIMIT)
  const rest = ordered.slice(RECENT_NPC_LIMIT).sort((a, b) => a.localeCompare(b))
  return [...recent, ...rest]
}

/**
 * The relevance tags of the most recently spoken line other than `excludeId` — the "previous
 * line" a freshly placed dialogue offers to copy. `[]` when there is no other line, or the one
 * found carries no tags to offer.
 */
function previousRelevanceFor(
  dialogues: readonly Dialogue[],
  excludeId: Dialogue['id'],
): readonly RelevanceTagId[] {
  const previous = dialogues
    .filter((candidate) => candidate.id !== excludeId)
    .sort((a, b) => b.spokenAt.localeCompare(a.spokenAt))[0]
  return previous?.relevance ?? []
}

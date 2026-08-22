import type { DragEvent as ReactDragEvent, ReactElement } from 'react'
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
import { GlyphLearner } from '../capture/GlyphLearner.tsx'
import type { UnknownTile } from '../capture/glyph-matcher.ts'
import { mergeGlyphs, readTextBox } from '../capture/glyph-matcher.ts'
import { DIALOGUE_MEDIA_ACCEPT, importDialogueMedia } from '../media/import-media.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { MediaView } from '../media/MediaView.tsx'
import { zoneHueStyle } from '../map/zone-style.ts'
import { currentDialogue, dispatch } from '../project/store.ts'
import { DialogueQuestLinks } from '../quest/DialogueQuestLinks.tsx'
import type {
  CaptureProfile,
  Dialogue,
  DialogueMedia,
  Glyph,
  ProjectFile,
  RelevanceTag,
  Zone,
} from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
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
      frame: ImageData
      tiles: readonly UnknownTile[]
    }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

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
}): ReactElement {
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const [captureState, setCaptureState] = useState<CaptureState>({ kind: 'idle' })
  const [dropTarget, setDropTarget] = useState(false)
  const pickerId = useId()
  const asideRef = useRef<HTMLElement>(null)
  // Filled by `DialogueForm`. The line field is a draft that only reaches the store on blur or
  // after an idle, and a capture appends to the store's text — so Ctrl+Enter straight out of the
  // textarea has to push the draft down first, or it appends to a line the user has moved past.
  const flushDraft = useRef<(() => void) | null>(null)

  const source = useCaptureSource()
  const profile = useActiveCaptureProfile(project.captureProfiles)
  const blocker = captureBlocker(source, profile)
  const busy = captureState.kind === 'capturing' || captureState.kind === 'learning'

  // Bound on `window`, not on the panel: the selected pin keeps focus after a click, and an
  // Escape aimed at "close this" would otherwise have to be pressed inside the panel first.
  // Stood down while the learner is up, so one Escape does not both cancel a capture in flight
  // and close the panel that was going to report what it did. Typing is exempt too — a text
  // field never loses what is being typed into it just because Escape was the key pressed —
  // and an open alertdialog or the quest picker claims the key before it can bubble this far;
  // see `useAlertDialogFocus` and `DialogueQuestLinks`'s picker.
  const learning = captureState.kind === 'learning'
  useEffect(() => {
    if (learning) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (isTextFieldFocused()) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, learning])

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
  }, [dialogueId])

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
      const { frame, reading } = await readLiveBox(profile)
      if (reading.unknown.length > 0) {
        setCaptureState({ kind: 'learning', profile, frame, tiles: reading.unknown })
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

  function onGlyphsLearned(target: CaptureProfile, frame: ImageData, glyphs: Glyph[]): void {
    dispatch({ kind: 'capture-profile/glyphs-learned', profileId: target.id, glyphs })
    // The store's own copy arrives on the next render and the transcript is wanted now, so the
    // grown alphabet is applied here through the same merge the reducer just ran — as CaptureBar
    // does. Re-read rather than assumed complete: two glyphs learned one bit apart stay ambiguous.
    const grown = { ...target, glyphs: mergeGlyphs(target.glyphs, glyphs) }
    const reading = readTextBox(frame, grown)
    if (reading.unknown.length > 0) {
      setCaptureState({ kind: 'learning', profile: grown, frame, tiles: reading.unknown })
      return
    }
    void write(grown, frame, reading.text)
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

  async function removeMedium(medium: DialogueMedia): Promise<void> {
    dispatch({ kind: 'dialogue/media-removed', dialogueId: dialogue.id, mediaId: medium.id })
    setImportState({ kind: 'idle' })
    // After the dispatch nothing in the document names the file, so it would sit in media/
    // forever, invisible from inside the app.
    await discardMediaFile(medium.file.fileName)
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
      ref={asideRef}
      className="dialogue-panel"
      aria-label="Dialogue"
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
        npcNames={npcNames}
        flushRef={flushDraft}
        autoFocusNpc={autoFocusNpc}
        onAutoFocusConsumed={onAutoFocusConsumed}
        previousRelevance={previousRelevance}
      />

      <section className="dialogue-media">
        <h3 className="micro-label">Media</h3>

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
                    className="button"
                    disabled={index === 0}
                    onClick={() => moveMedium(medium, index - 1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={index === dialogue.media.length - 1}
                    onClick={() => moveMedium(medium, index + 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void removeMedium(medium)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
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
      <CaptureBar profiles={project.captureProfiles} />

      <DialogueQuestLinks dialogue={dialogue} quests={project.quests} />

      {/* Cancelling keeps the picture and says the text was not transcribed — the frame is the
          record, and it is the half that cannot be produced again once the game has advanced. */}
      {captureState.kind === 'learning' && (
        <GlyphLearner
          tiles={captureState.tiles}
          onCancel={() => void write(captureState.profile, captureState.frame, null)}
          onConfirm={(glyphs) =>
            onGlyphsLearned(captureState.profile, captureState.frame, glyphs)
          }
        />
      )}
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
): readonly RelevanceTag[] {
  const previous = dialogues
    .filter((candidate) => candidate.id !== excludeId)
    .sort((a, b) => b.spokenAt.localeCompare(a.spokenAt))[0]
  return previous?.relevance ?? []
}

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useActiveCaptureProfile } from '../capture/active-profile.ts'
import {
  captureBlocker,
  captureIntoDialogue,
  describeCapture,
  readLiveBox,
} from '../capture/capture-to-dialogue.ts'
import { useCaptureSource } from '../capture/capture-session.ts'
import type { UnknownTile } from '../capture/glyph-matcher.ts'
import { mergeGlyphs, readTextBox } from '../capture/glyph-matcher.ts'
import { currentDialogue, dispatch } from '../project/store.ts'
import type { CaptureProfile, Dialogue, DialogueId, Glyph, ProjectFile } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'

/** The in-page shortcut, and the words for it — the emulator has the keyboard the rest of the time. */
const CAPTURE_KEY = 'Enter'
export const CAPTURE_SHORTCUT = 'Ctrl+Enter'

/**
 * One press of the capture button, as the panel sees it.
 *
 * `learning` holds the frame that raised the question, because the emulator has moved on by the
 * time the characters are typed in — and it is the state that makes "nothing is written until the
 * box can be read whole" true, rather than a rule the handler is trusted to follow.
 */
export type CaptureState =
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

/** Whether a press is in flight or a learner is up over its frame — the disabled condition for both the button and the shortcut. */
export function isCaptureBusy(state: CaptureState): boolean {
  return state.kind === 'capturing' || state.kind === 'learning'
}

export type CaptureApi = {
  captureState: CaptureState
  setCaptureState: (state: CaptureState) => void
  /** A press is in flight, or a learner is up over its frame — disables the button and the shortcut. */
  busy: boolean
  /** Why a capture cannot run right now, in a sentence naming the fix — `null` when it can. */
  blocker: string | null
  /** The learner overlay is up — the panel stands its own Escape-to-close handler down while it is. */
  learning: boolean
  /**
   * One press: the frame becomes a picture on the pin and the new part of the box becomes text.
   *
   * An unreadable tile stops the chain here, before anything is written — a dialogue must never
   * end up holding a picture beside half a sentence.
   */
  capture: () => Promise<void>
  /** `transcript === null` is a box that could not be read whole: the picture is kept, the line is not. */
  write: (target: CaptureProfile, frame: ImageData, transcript: string | null) => Promise<void>
  onGlyphsLearned: (
    target: CaptureProfile,
    alphabet: readonly Glyph[],
    frame: ImageData,
    learned: Glyph[],
  ) => void
}

/**
 * The panel's capture button: one press against the live capture source, the `GlyphLearner`
 * handoff when a tile cannot be read, and the `Ctrl+Enter` shortcut that drives the same press
 * from the keyboard.
 *
 * `dialogueId` and `dialogue` are both taken — never only the id — because `write` falls back to
 * the prop when the store has nothing under that id, exactly as it always has.
 *
 * CRITICAL: `write` reads the dialogue to append to through `currentDialogue(dialogueId)`, taken
 * fresh *after* every `await`, never through a `dialogue` closed over before one. `capture-to-
 * dialogue.ts`'s own `captureIntoDialogue` depends on the same guarantee one layer down — see its
 * comment around `currentDialogue` — because encoding and writing a PNG takes long enough for a
 * second capture (the watcher ticking mid-press, or a held frame being replayed) to have finished
 * its own append first, and computing this one from a pre-await snapshot would overwrite it
 * silently.
 */
export function useCapture(
  project: ProjectFile,
  dialogueId: DialogueId,
  dialogue: Dialogue,
  flushDraft: RefObject<(() => void) | null>,
): CaptureApi {
  const [captureState, setCaptureState] = useState<CaptureState>({ kind: 'idle' })

  // A warning or an error belongs to the capture that produced it, and would otherwise hang over
  // whichever dialogue the user selected next.
  useEffect(() => {
    setCaptureState({ kind: 'idle' })
  }, [dialogueId])

  const source = useCaptureSource()
  const profile = useActiveCaptureProfile(project.captureProfiles)
  const blocker = captureBlocker(source, profile)
  const busy = isCaptureBusy(captureState)
  const learning = captureState.kind === 'learning'

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
      setCaptureState({
        kind: 'learning',
        profile: target,
        glyphs: grown,
        frame,
        tiles: reading.unknown,
      })
      return
    }
    void write(target, frame, reading.text)
  }

  // The handler closes over `capture`, so it is a new function on every keystroke in the line
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

  return { captureState, setCaptureState, busy, blocker, learning, capture, write, onGlyphsLearned }
}

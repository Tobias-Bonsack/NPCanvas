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

const CAPTURE_KEY = 'Enter'
export const CAPTURE_SHORTCUT = 'Ctrl+Enter'

// `learning` holds the frame that raised the question, since the emulator has moved on by the
// time the tiles are typed in — the state itself is what makes "nothing written until the box
// reads whole" true, not a rule the handler must remember to follow.
export type CaptureState =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | {
      kind: 'learning'
      // The capture stays with the profile and alphabet it started under, whatever the bar
      // switches to — glyphs includes tiles just typed in that the store hasn't handed back yet.
      profile: CaptureProfile
      glyphs: readonly Glyph[]
      frame: ImageData
      tiles: readonly UnknownTile[]
    }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

export function isCaptureBusy(state: CaptureState): boolean {
  return state.kind === 'capturing' || state.kind === 'learning'
}

export type CaptureApi = {
  captureState: CaptureState
  setCaptureState: (state: CaptureState) => void
  busy: boolean
  blocker: string | null
  learning: boolean
  // An unreadable tile stops the chain here, before anything is written.
  capture: () => Promise<void>
  // transcript === null is a box that couldn't be read whole: the picture is kept, the line isn't.
  write: (target: CaptureProfile, frame: ImageData, transcript: string | null) => Promise<void>
  onGlyphsLearned: (
    target: CaptureProfile,
    alphabet: readonly Glyph[],
    frame: ImageData,
    learned: Glyph[],
  ) => void
}

// dialogueId and dialogue are both taken (never only the id) because write falls back to the
// prop when the store has nothing under that id.
//
// write reads the dialogue to append to through currentDialogue(dialogueId), taken fresh after
// every await, never a pre-await `dialogue` closure — encoding/writing a PNG takes long enough
// for a second capture to finish its own append first, which a stale snapshot would overwrite.
export function useCapture(
  project: ProjectFile,
  dialogueId: DialogueId,
  dialogue: Dialogue,
  flushDraft: RefObject<(() => void) | null>,
): CaptureApi {
  const [captureState, setCaptureState] = useState<CaptureState>({ kind: 'idle' })

  // A warning/error belongs to the capture that produced it, not whichever dialogue is next.
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
      // The document as it stands now, not as this render saw it — a learner can stand open
      // for minutes while the panel keeps taking edits.
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
    // The store's copy arrives next render but the transcript is wanted now, so the grown
    // alphabet is applied here through the same merge the reducer just ran, as CaptureBar does.
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

  // capture is a new function every render; the ref keeps the window binding stable.
  const captureRef = useRef(capture)
  useEffect(() => {
    captureRef.current = capture
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== CAPTURE_KEY || !event.ctrlKey || event.altKey || event.shiftKey) return
      // The line field is a textarea; the default would be a newline in the text being appended.
      event.preventDefault()
      void captureRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return { captureState, setCaptureState, busy, blocker, learning, capture, write, onGlyphsLearned }
}

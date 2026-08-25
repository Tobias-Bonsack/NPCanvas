import { assertNever } from '../assert-never.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { importDialogueMedia } from '../media/import-media.ts'
import { currentDialogue, dispatch } from '../project/store.ts'
import type { CaptureProfile, Dialogue, DialogueMedia, Glyph } from '../project/types.ts'
import { appendWithoutOverlap } from './append-overlap.ts'
import { profileApplies } from './capture-profile.ts'
import type { CaptureSource } from './capture-session.ts'
import { grabFrame } from './capture-session.ts'
import type { PixelBuffer, TextBoxReading } from './glyph-matcher.ts'
import { readTextBox, sampleNative } from './glyph-matcher.ts'

// One press: a frame of the running game becomes a picture on the pin and a line in the text field.
//
// This is the wiring the rest of M7.5 was built for — `capture-session.ts` produces the frame,
// `glyph-matcher.ts` reads the box, `append-overlap.ts` decides what of it is new, and
// `import-media.ts` puts the picture in `media/`. Nothing here is React, so the panel owns only the
// button, the learner and the messages.
//
// The picture is the **whole console screen**, text box included. The transcript already carries
// the words, so the box is redundant in principle — but a transcript is derived and the frame it
// came from is the record, which is what makes a mis-learned glyph recoverable by looking.

/** What one capture did, once the picture and the line were written. */
export type CaptureResult = {
  /**
   * What happened to the line. `unchanged` is its own outcome rather than a silent no-op: the
   * likeliest misfire is capturing twice without advancing the game, and a button that appears to
   * have done nothing is indistinguishable from a broken one.
   */
  text: 'appended' | 'unchanged' | 'not-transcribed'
  /** Which picture this became, counted from one — the first is what the pin wears. */
  picture: number
  /**
   * The medium the picture became. Named rather than merely counted, because a caller that writes
   * unattended has to be able to take it back again: the watcher judges a box against the two
   * around it, and a `MediaId` is what a removal addresses — see CLAUDE.md § Media contract.
   */
  media: DialogueMedia
}

/** One read of the live frame, kept together with the frame it came from. */
export type BoxRead = {
  /**
   * Carried beside the reading because learning a tile has to transcribe *that* frame again: the
   * emulator has moved on by the time the characters are typed in, and re-grabbing would read a
   * different box than the one being asked about.
   */
  frame: ImageData
  reading: TextBoxReading
}

/**
 * Why a capture cannot run right now, in a sentence that names the fix — `null` when it can.
 *
 * Every caller uses this for both the disabled state and the explanation beside it, so a button
 * can never end up disabled and silent.
 */
export function captureBlocker(
  source: CaptureSource,
  profile: CaptureProfile | null,
): string | null {
  switch (source.kind) {
    case 'idle':
      return 'Connect a screen or window below — a capture reads the frame the emulator is drawing.'
    case 'failed':
      return 'The capture source failed. Connect a screen or window again below.'
    case 'requesting':
      return 'Choose a source in the picker to finish connecting.'
    case 'live':
      break
    default:
      return assertNever(source)
  }

  if (profile === null) {
    return 'Calibrate a capture profile below — it says where the console screen and its text box sit inside the frame.'
  }
  if (!profileApplies(profile, source.frameWidth, source.frameHeight)) {
    return (
      `${profile.name} was calibrated against a ${profile.frameWidth} × ${profile.frameHeight} ` +
      `frame, but this source is ${source.frameWidth} × ${source.frameHeight}. Re-calibrate it ` +
      'below before capturing.'
    )
  }
  return null
}

/** The live frame and what the text box says, which is where every capture starts. */
export async function readLiveBox(
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
): Promise<BoxRead> {
  const frame = await grabFrame()
  return { frame, reading: readTextBox(frame, profile, glyphs) }
}

/**
 * The console screen alone, at native resolution, as a PNG file ready for `importDialogueMedia`.
 *
 * Native resolution rather than the frame's: the emulator's upscaling is not information, and a
 * 160 × 144 PNG of a two-colour screen is a couple of kilobytes per line logged. PNG rather than
 * JPEG for the reason `freezeFrame` gives — ringing around 8-pixel glyph edges is exactly the
 * artefact that would make a saved frame useless as the record of what was read.
 */
export async function screenPng(frame: PixelBuffer, profile: CaptureProfile): Promise<File> {
  const native = sampleNative(frame, profile.screenRect, profile.nativeWidth, profile.nativeHeight)

  const canvas = document.createElement('canvas')
  canvas.width = native.width
  canvas.height = native.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('This browser provided no 2D canvas context.')

  // Through `createImageData` rather than the `ImageData` constructor: the buffer is copied into
  // one the context already owns, which keeps the pixels out of the constructor's typed-array
  // generics for no cost worth measuring at 160 × 144.
  const image = context.createImageData(native.width, native.height)
  image.data.set(native.data)
  context.putImageData(image, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (blob === null) throw new Error('The captured screen could not be encoded as a PNG.')
  // The name is a label only — `importDialogueMedia` derives the real one in `media/` from the
  // dialogue and media ids. See CLAUDE.md § Media contract.
  return new File([blob], 'capture.png', { type: 'image/png' })
}

/**
 * Writes one capture into the dialogue: the picture always, the transcript only when there is one.
 *
 * `transcript === null` is a box that could not be fully read — the learner was cancelled. The
 * picture is still worth keeping, and a line half transcribed is not, so this is the split that
 * keeps a dialogue from ever holding a sentence with holes in it.
 *
 * `spokenAt` is deliberately untouched: it records when the line was heard, and the dialogue was
 * created when the pin was placed.
 */
export async function captureIntoDialogue(
  dialogue: Dialogue,
  profile: CaptureProfile,
  frame: PixelBuffer,
  transcript: string | null,
): Promise<CaptureResult> {
  const { media } = await importDialogueMedia(dialogue.id, await screenPng(frame, profile))
  dispatch({ kind: 'dialogue/media-added', dialogueId: dialogue.id, media })

  // A capture is a write to media/ followed by a dispatch, so it has the panel's import hole
  // too: delete the pin while the frame is being encoded and the dispatch is a silent no-op,
  // leaving a file nothing in the document names. The cascade that deleted the dialogue ran
  // before this file existed, so this is the only place that can still remove it.
  //
  // The document as it stands *now*, and the line is appended to that copy rather than to the
  // argument: encoding a PNG and writing it takes long enough for a second capture — the watcher
  // ticking during a manual press, or a held frame being replayed — to have finished its own
  // append, and computing this one from the pre-await snapshot would overwrite it silently, with
  // both pictures left in place to disagree with the line.
  const into = currentDialogue(dialogue.id)
  if (into === null) {
    await discardMediaFile(media.file.fileName)
    throw new Error('The dialogue was deleted while capturing. Nothing was kept.')
  }

  // The dispatch above has already landed, so this frame is in the list and counted.
  const picture = into.media.length
  const outcome = appendOutcome(into.text, transcript)
  if (outcome.text === 'appended') {
    dispatch({ kind: 'dialogue/text-set', dialogueId: dialogue.id, text: outcome.next })
  }
  return { text: outcome.text, picture, media }
}

/**
 * What appending `transcript` to `existing` would do, and what the line would then say.
 *
 * Split out of `captureIntoDialogue` because the watcher has to know **before** it writes: a box
 * that says nothing new is the ordinary case for a loop reading four times a second, and writing a
 * picture for it would bury the conversation under identical frames. A deliberate press is a claim
 * that *this* frame is worth keeping, so the manual path still attaches its picture either way —
 * only the caller that fires unattended asks first.
 *
 * `next` is `existing` **itself** when nothing is new, which is `appendWithoutOverlap`'s own
 * guarantee rather than a comparison invented here.
 */
export function appendOutcome(
  existing: string,
  transcript: string | null,
): { text: CaptureResult['text']; next: string } {
  // A box that could not be read whole. The picture is still the record; a sentence with holes
  // in it is not, so the line is left exactly as it stands.
  if (transcript === null) return { text: 'not-transcribed', next: existing }

  const next = appendWithoutOverlap(existing, transcript)
  return next === existing ? { text: 'unchanged', next: existing } : { text: 'appended', next }
}

/**
 * What the panel says afterwards. Every outcome names both halves — the picture and the line.
 *
 * Takes only the two fields it reads, so a caller with nothing but an outcome to describe — a test,
 * or a message assembled after the medium has been dealt with — does not have to invent one.
 */
export function describeCapture(result: Pick<CaptureResult, 'text' | 'picture'>): string {
  const picture =
    result.picture === 1
      ? 'Captured. The picture is the first one, so it is what the pin shows.'
      : `Captured. That is picture ${result.picture}.`

  switch (result.text) {
    case 'appended':
      return `${picture} What the text box said that the line did not is now part of it.`
    case 'unchanged':
      return `${picture} The text box said nothing the line does not already say, so the line is unchanged.`
    case 'not-transcribed':
      return `${picture} The text was not transcribed, so the line is unchanged — capture again once the alphabet knows every tile.`
    default:
      return assertNever(result.text)
  }
}

import { assertNever } from '../assert-never.ts'
import { importDialogueMedia } from '../media/import-media.ts'
import { dispatch } from '../project/store.ts'
import type { CaptureProfile, Dialogue } from '../project/types.ts'
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
export async function readLiveBox(profile: CaptureProfile): Promise<BoxRead> {
  const frame = await grabFrame()
  return { frame, reading: readTextBox(frame, profile) }
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
  const picture = dialogue.media.length + 1

  if (transcript === null) return { text: 'not-transcribed', picture }

  const text = appendWithoutOverlap(dialogue.text, transcript)
  // `appendWithoutOverlap` returns the existing text itself when nothing is new, so this is the
  // same frame read twice — or an empty box — rather than a comparison that had to be invented.
  if (text === dialogue.text) return { text: 'unchanged', picture }

  dispatch({ kind: 'dialogue/text-set', dialogueId: dialogue.id, text })
  return { text: 'appended', picture }
}

/** What the panel says afterwards. Every outcome names both halves — the picture and the line. */
export function describeCapture(result: CaptureResult): string {
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

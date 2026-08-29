import { assertNever } from '../assert-never.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { importDialogueMedia } from '../media/import-media.ts'
import { currentDialogue, dispatch } from '../project/store.ts'
import type { CaptureProfile, Dialogue, DialogueMedia, Glyph, Point } from '../project/types.ts'
import { appendWithoutOverlap } from './append-overlap.ts'
import { profileApplies } from './capture-profile.ts'
import type { CaptureSource } from './capture-session.ts'
import { grabFrame } from './capture-session.ts'
import type { PixelBuffer, TextBoxReading } from './glyph-matcher.ts'
import { readTextBox, sampleNative } from './glyph-matcher.ts'

// The picture is the **whole console screen**, text box included, even though the transcript
// already carries the words: the transcript is derived, and the frame it came from is the record,
// which is what makes a mis-learned glyph recoverable by looking.

type CaptureResult = {
  // `unchanged` is its own outcome rather than a silent no-op — capturing twice without advancing
  // the game is the likeliest misfire, and a button that appears to do nothing reads as broken.
  text: 'appended' | 'unchanged' | 'not-transcribed'
  picture: number
  // Named rather than merely counted — a caller writing unattended has to be able to take it back
  // again, and a `MediaId` is what a removal addresses (CLAUDE.md § Media contract).
  media: DialogueMedia
}

type BoxRead = {
  // Carried beside the reading, since learning a tile has to transcribe *that* frame again — the
  // emulator has moved on by the time characters are typed in.
  frame: ImageData
  reading: TextBoxReading
}

// `null` when a capture can run; every caller uses this string for both the disabled state and
// the explanation beside it.
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

// Grabs the **whole** frame rather than cropping to `profile.screenRect`: this frame is handed
// back to `DialoguePanel`/`CaptureBar`, which re-read it after the alphabet grows, outside this
// crop's own accounting. Only `capture-watch.ts`'s tick, which owns every frame end to end, crops.
export async function readLiveBox(
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
): Promise<BoxRead> {
  const { pixels } = await grabFrame()
  return { frame: pixels, reading: readTextBox(pixels, profile, glyphs) }
}

// Native resolution, not the frame's — the emulator's upscaling is not information, and a
// 160x144 PNG of a two-colour screen is a couple of kilobytes per line logged.
export async function screenPng(
  frame: PixelBuffer,
  profile: CaptureProfile,
  origin?: Point,
): Promise<File> {
  const native = sampleNative(frame, profile.screenRect, profile.nativeWidth, profile.nativeHeight, origin)

  const canvas = document.createElement('canvas')
  canvas.width = native.width
  canvas.height = native.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('This browser provided no 2D canvas context.')

  const image = context.createImageData(native.width, native.height)
  image.data.set(native.data)
  context.putImageData(image, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (blob === null) throw new Error('The captured screen could not be encoded as a PNG.')
  // The name is a label only — `importDialogueMedia` derives the real one (CLAUDE.md § Media contract).
  return new File([blob], 'capture.png', { type: 'image/png' })
}

// The picture is written always, the transcript only when there is one — `transcript === null`
// means the learner was cancelled, and a line half transcribed is worse than no line at all.
// `spokenAt` is deliberately untouched: it records when heard, not when captured.
export async function captureIntoDialogue(
  dialogue: Dialogue,
  profile: CaptureProfile,
  frame: PixelBuffer,
  transcript: string | null,
): Promise<CaptureResult> {
  const { media } = await importDialogueMedia(dialogue.id, await screenPng(frame, profile))
  dispatch({ kind: 'dialogue/media-added', dialogueId: dialogue.id, media })

  // Re-reads the document rather than using the argument: deleting the pin mid-encode would
  // otherwise leave a file nothing names, and a concurrent capture (the watcher, or a replay)
  // could have appended its own line onto the pre-await snapshot in the meantime.
  const into = currentDialogue(dialogue.id)
  if (into === null) {
    await discardMediaFile(media.file.fileName)
    throw new Error('The dialogue was deleted while capturing. Nothing was kept.')
  }

  const picture = into.media.length
  const outcome = appendOutcome(into.text, transcript)
  if (outcome.text === 'appended') {
    dispatch({ kind: 'dialogue/text-set', dialogueId: dialogue.id, text: outcome.next })
  }
  return { text: outcome.text, picture, media }
}

// Split out of `captureIntoDialogue` because the watcher must know **before** it writes: an
// unattended box saying nothing new shouldn't bury the conversation under identical frames, while
// a deliberate press still attaches its picture either way. `next` is `existing` itself when
// nothing is new — `appendWithoutOverlap`'s own guarantee, not a comparison invented here.
export function appendOutcome(
  existing: string,
  transcript: string | null,
): { text: CaptureResult['text']; next: string } {
  if (transcript === null) return { text: 'not-transcribed', next: existing }

  const next = appendWithoutOverlap(existing, transcript)
  return next === existing ? { text: 'unchanged', next: existing } : { text: 'appended', next }
}

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

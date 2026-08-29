import type { CaptureProfile, Glyph } from '../project/types.ts'
import { readTextBox } from './glyph-matcher.ts'
import type { TextBoxReading } from './glyph-matcher.ts'

// The watcher's read, off the main thread (#117).
//
// This worker imports only `glyph-matcher.ts` and its type dependencies — no `store.ts`, no
// `reducer.ts`, no `capture-watch.ts`, nothing that touches `document`. `glyph-matcher.ts`'s own
// opening comment already states the property that makes this possible: "Everything here is
// pure — `capture-session.ts` produces the pixels, this decides what they say." The store, every
// `dispatch`, `capture-watch.ts`'s state machine, the pending-capture queue and the held-frame
// queue all stay on the main thread; this is a compute engine handed pixels, nothing more — the
// same line CLAUDE.md draws in § "Async IO never enters the reducer" and § "Store scope".

/**
 * One read request. `glyphs` is `undefined` when the caller's alphabet has not changed since the
 * last request: `postMessage` structured-clones every array it carries, so resending it on every
 * tick would hand `readTextBox`'s own identity-keyed caches (#114, #115) a **new** array every
 * time and defeat them from inside the very thread built to make them cheap. The worker keeps
 * whatever alphabet it was last given and reuses that reference until told otherwise.
 */
type ReadRequest = {
  sequence: number
  bitmap: ImageBitmap
  origin: { x: number; y: number }
  profile: CaptureProfile
  glyphs: readonly Glyph[] | undefined
}

type ReadResponse =
  | { kind: 'read'; sequence: number; reading: TextBoxReading }
  | { kind: 'error'; sequence: number; message: string }

/**
 * This project's tsconfig carries only the `DOM` lib (see CLAUDE.md § TypeScript layout), whose
 * `self` is `Window` — `onmessage`/`postMessage` there take a target origin a worker's do not.
 * Adding the `WebWorker` lib just for this one file would instead conflict with `DOM` over the
 * globals both declare (`self`, `caches`, …), so `self` is retyped narrowly to the two members
 * this file actually calls, rather than pulling in a whole second global environment for them.
 */
const context = self as unknown as {
  onmessage: ((event: MessageEvent<ReadRequest>) => void) | null
  postMessage: (message: ReadResponse) => void
}

/** Reused across reads — the one canvas this worker ever needs to decode a bitmap into pixels. */
let canvas: OffscreenCanvas | null = null

/** The alphabet last received, kept by reference so an unchanged one keeps its identity. */
let retainedGlyphs: readonly Glyph[] = []

context.onmessage = (event) => {
  const { sequence, bitmap, origin, profile, glyphs } = event.data
  if (glyphs !== undefined) retainedGlyphs = glyphs

  try {
    const frame = decode(bitmap)
    const reading = readTextBox(frame, profile, retainedGlyphs, origin)
    context.postMessage({ kind: 'read', sequence, reading })
  } catch (error) {
    context.postMessage({
      kind: 'error',
      sequence,
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    bitmap.close()
  }
}

function decode(bitmap: ImageBitmap): ImageData {
  canvas ??= new OffscreenCanvas(bitmap.width, bitmap.height)
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width
    canvas.height = bitmap.height
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('This worker provided no 2D canvas context.')
  context.drawImage(bitmap, 0, 0)
  return context.getImageData(0, 0, bitmap.width, bitmap.height)
}

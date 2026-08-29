import type { CaptureProfile, Glyph } from '../project/types.ts'
import type { PixelBuffer, TextBoxReading } from './glyph-matcher.ts'
import { readTextBox, sampleNative } from './glyph-matcher.ts'

// The watcher's read, off the main thread (#117) — and, once a box settles, the picture's PNG
// encode too (#118).
//
// This worker imports only `glyph-matcher.ts` and its type dependencies — no `store.ts`, no
// `reducer.ts`, no `capture-watch.ts`, nothing that touches `document`. `glyph-matcher.ts`'s own
// opening comment already states the property that makes this possible: "Everything here is
// pure — `capture-session.ts` produces the pixels, this decides what they say." The store, every
// `dispatch`, `capture-watch.ts`'s state machine, the pending-capture queue and the held-frame
// queue all stay on the main thread; this is a compute engine handed pixels, nothing more — the
// same line CLAUDE.md draws in § "Async IO never enters the reducer" and § "Store scope".

type Origin = { x: number; y: number }

/**
 * One read request. `glyphs` is `undefined` when the caller's alphabet has not changed since the
 * last request: `postMessage` structured-clones every array it carries, so resending it on every
 * tick would hand `readTextBox`'s own identity-keyed caches (#114, #115) a **new** array every
 * time and defeat them from inside the very thread built to make them cheap. The worker keeps
 * whatever alphabet it was last given and reuses that reference until told otherwise.
 */
type ReadRequest = {
  kind: 'read'
  sequence: number
  bitmap: ImageBitmap
  origin: Origin
  profile: CaptureProfile
  glyphs: readonly Glyph[] | undefined
}

/** One box settled, so its picture is worth writing — the PNG encode `screenPng` did before #118. */
type EncodeRequest = {
  kind: 'encode'
  sequence: number
  bitmap: ImageBitmap
  origin: Origin
  profile: CaptureProfile
}

type WorkerRequest = ReadRequest | EncodeRequest

type WorkerResponse =
  | { kind: 'read'; sequence: number; reading: TextBoxReading }
  | { kind: 'encoded'; sequence: number; blob: Blob }
  | { kind: 'error'; sequence: number; message: string }

/**
 * This project's tsconfig carries only the `DOM` lib (see CLAUDE.md § TypeScript layout), whose
 * `self` is `Window` — `onmessage`/`postMessage` there take a target origin a worker's do not.
 * Adding the `WebWorker` lib just for this one file would instead conflict with `DOM` over the
 * globals both declare (`self`, `caches`, …), so `self` is retyped narrowly to the two members
 * this file actually calls, rather than pulling in a whole second global environment for them.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse, transfer: Transferable[]) => void
}

/** Reused across reads and encodes — the one canvas this worker ever needs a bitmap decoded into. */
let canvas: OffscreenCanvas | null = null

/** The alphabet last received, kept by reference so an unchanged one keeps its identity. */
let retainedGlyphs: readonly Glyph[] = []

scope.onmessage = (event) => {
  const request = event.data
  try {
    if (request.kind === 'read') {
      if (request.glyphs !== undefined) retainedGlyphs = request.glyphs
      const frame = decode(request.bitmap)
      const reading = readTextBox(frame, request.profile, retainedGlyphs, request.origin)
      scope.postMessage({ kind: 'read', sequence: request.sequence, reading }, [])
    } else {
      const frame = decode(request.bitmap)
      encodePng(frame, request.profile, request.origin)
        .then((blob) => scope.postMessage({ kind: 'encoded', sequence: request.sequence, blob }, [blob]))
        .catch((error: unknown) => postError(request.sequence, error))
    }
  } catch (error) {
    postError(request.sequence, error)
  } finally {
    request.bitmap.close()
  }
}

function postError(sequence: number, error: unknown): void {
  scope.postMessage(
    { kind: 'error', sequence, message: error instanceof Error ? error.message : String(error) },
    [],
  )
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

/**
 * The console screen alone, at native resolution, as a PNG — mirrors `screenPng`
 * (`capture-to-dialogue.ts`) exactly, byte for byte, so a switch between the worker and the
 * main-thread fallback is invisible in `media/`. That function stays as the fallback path itself;
 * this is the same three steps run through `OffscreenCanvas.convertToBlob` instead of
 * `HTMLCanvasElement.toBlob`, because a worker has no `document` to create the latter from.
 */
async function encodePng(frame: PixelBuffer, profile: CaptureProfile, origin: Origin): Promise<Blob> {
  const native = sampleNative(frame, profile.screenRect, profile.nativeWidth, profile.nativeHeight, origin)

  const target = new OffscreenCanvas(native.width, native.height)
  const context = target.getContext('2d')
  if (context === null) throw new Error('This worker provided no 2D canvas context.')

  const image = context.createImageData(native.width, native.height)
  image.data.set(native.data)
  context.putImageData(image, 0, 0)

  return target.convertToBlob({ type: 'image/png' })
}

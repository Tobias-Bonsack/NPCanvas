import type { CaptureProfile, Glyph } from '../project/types.ts'
import type { ScreenMeasurement } from './auto-calibrate.ts'
import { measureCalibration } from './auto-calibrate.ts'
import type { PixelBuffer, TextBoxReading } from './glyph-matcher.ts'
import { readTextBox, sampleNative } from './glyph-matcher.ts'

// The watcher's read, the picture encode and the calibration measurement, off the main thread.
// This worker imports only the pure `glyph-matcher.ts` / `auto-calibrate.ts` pair and their type
// dependencies — no `store.ts`, no `reducer.ts`, nothing that touches `document` — since the store,
// every `dispatch`, and both capture queues must stay on the main thread (CLAUDE.md § "Async IO
// never enters the reducer").

type Origin = { x: number; y: number }

// `glyphs` is `undefined` when the alphabet hasn't changed since the last request — resending it
// every tick would hand `readTextBox`'s identity-keyed caches a **new** array each time and defeat
// them from inside the very thread built to make them cheap.
type ReadRequest = {
  kind: 'read'
  sequence: number
  bitmap: ImageBitmap
  origin: Origin
  profile: CaptureProfile
  glyphs: readonly Glyph[] | undefined
}

type EncodeRequest = {
  kind: 'encode'
  sequence: number
  bitmap: ImageBitmap
  origin: Origin
  profile: CaptureProfile
}

// The one request the player waits on: 110 ms on a 3840x2088 frame, and it is a button press,
// not a tick.
type CalibrateRequest = {
  kind: 'calibrate'
  sequence: number
  bitmap: ImageBitmap
  nativeWidth: number
  nativeHeight: number
}

type WorkerRequest = ReadRequest | EncodeRequest | CalibrateRequest

type WorkerResponse =
  | { kind: 'read'; sequence: number; reading: TextBoxReading }
  | { kind: 'encoded'; sequence: number; blob: Blob }
  | { kind: 'calibrated'; sequence: number; measurement: ScreenMeasurement }
  | { kind: 'error'; sequence: number; message: string }

// This project's tsconfig carries only the `DOM` lib, whose `self` is `Window`. Adding the
// `WebWorker` lib for this one file would conflict with `DOM` over shared globals, so `self` is
// retyped narrowly to the two members this file actually calls.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse, transfer: Transferable[]) => void
}

let canvas: OffscreenCanvas | null = null

// Kept by reference so an unchanged alphabet keeps its identity.
let retainedGlyphs: readonly Glyph[] = []

scope.onmessage = (event) => {
  const request = event.data
  try {
    if (request.kind === 'read') {
      if (request.glyphs !== undefined) retainedGlyphs = request.glyphs
      const frame = decode(request.bitmap)
      const reading = readTextBox(frame, request.profile, retainedGlyphs, request.origin)
      scope.postMessage({ kind: 'read', sequence: request.sequence, reading }, [])
    } else if (request.kind === 'calibrate') {
      const frame = decode(request.bitmap)
      const measurement = measureCalibration(frame, request.nativeWidth, request.nativeHeight)
      scope.postMessage({ kind: 'calibrated', sequence: request.sequence, measurement }, [])
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

// Mirrors `screenPng` (`capture-to-dialogue.ts`) exactly, byte for byte, so switching between the
// worker and the main-thread fallback is invisible in `media/`; uses `convertToBlob` since a
// worker has no `document` to create an `HTMLCanvasElement` from.
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

import type { CaptureProfile, Glyph } from '../project/types.ts'
import type { ScreenMeasurement } from './auto-calibrate.ts'
import { measureCalibration } from './auto-calibrate.ts'
import { screenPng } from './capture-to-dialogue.ts'
import type { TextBoxReading } from './glyph-matcher.ts'
import { readTextBox } from './glyph-matcher.ts'

// The main thread's side of `capture-read-worker.ts`. Every request falls back to the same
// function the worker would have run, so a browser without workers loses latency, never a frame.

type WorkerResponse =
  | { kind: 'read'; sequence: number; reading: TextBoxReading }
  | { kind: 'encoded'; sequence: number; blob: Blob }
  | { kind: 'calibrated'; sequence: number; measurement: ScreenMeasurement }
  | { kind: 'error'; sequence: number; message: string }

const WORKER_READ_TIMEOUT_MS = 5_000

let worker: Worker | null = null
// Sticky for the session once a worker fails to start or crashes — see `readWorker`.
let workerUnavailable = false
let nextRequestSequence = 0

type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const pendingReads = new Map<number, Pending<TextBoxReading>>()
const pendingEncodes = new Map<number, Pending<Blob>>()
const pendingMeasures = new Map<number, Pending<ScreenMeasurement>>()

// The alphabet last **sent** to the worker, by reference. `postMessage` structured-clones its
// payload, so sending `glyphs` on every tick would defeat `readTextBox`'s identity-keyed caches
// inside the worker; `readBox` sends it again only when this reference has moved.
let lastSentGlyphs: readonly Glyph[] | null = null

// Created lazily on the first request and kept for the session — `stopRecording` does not tear it
// down, since a manual capture can still reach for it later. Once unavailable, stays that way.
function readWorker(): Worker | null {
  if (workerUnavailable) return null
  if (worker !== null) return worker
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    workerUnavailable = true
    return null
  }
  try {
    const created = new Worker(new URL('./capture-read-worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      routeResponse(pendingReads, event.data, (data) => (data.kind === 'read' ? data.reading : undefined))
      routeResponse(pendingEncodes, event.data, (data) => (data.kind === 'encoded' ? data.blob : undefined))
      routeResponse(pendingMeasures, event.data, (data) =>
        data.kind === 'calibrated' ? data.measurement : undefined,
      )
    }
    created.onerror = () => {
      workerUnavailable = true
      worker = null
      failAll(pendingReads)
      failAll(pendingEncodes)
      failAll(pendingMeasures)
    }
    worker = created
    return created
  } catch {
    workerUnavailable = true
    return null
  }
}

// `sequence` is a single counter shared by every request kind, so it names at most one pending
// entry across the maps — a lookup in the wrong map simply misses.
function routeResponse<T>(
  pending: Map<number, Pending<T>>,
  data: WorkerResponse,
  value: (data: WorkerResponse) => T | undefined,
): void {
  const entry = pending.get(data.sequence)
  if (entry === undefined) return
  clearTimeout(entry.timer)
  pending.delete(data.sequence)
  if (data.kind === 'error') {
    entry.reject(new Error(data.message))
    return
  }
  const resolved = value(data)
  if (resolved !== undefined) entry.resolve(resolved)
}

function failAll<T>(pending: Map<number, Pending<T>>): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(new Error('The capture read worker failed.'))
  }
  pending.clear()
}

async function requestFromWorker<T>(
  active: Worker,
  pending: Map<number, Pending<T>>,
  build: (sequence: number) => WorkerRequestPayload,
): Promise<T> {
  const sequence = ++nextRequestSequence
  return new Promise<T>((resolve, reject) => {
    // A stuck worker throws nothing at all, so this timer is the only backstop against hanging forever.
    const timer = setTimeout(() => {
      if (pending.delete(sequence)) reject(new Error('The capture read worker did not answer in time.'))
    }, WORKER_READ_TIMEOUT_MS)
    pending.set(sequence, { resolve, reject, timer })
    const { message, transfer } = build(sequence)
    active.postMessage(message, transfer)
  })
}

type WorkerRequestPayload = { message: unknown; transfer: Transferable[] }

// `native` is sent as a structured clone rather than transferred: it is 90 KB, and the caller
// still holds the only copy of that frame for the held queue and the picture.
export async function readBox(
  native: ImageData,
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
): Promise<TextBoxReading> {
  const active = readWorker()
  if (active === null) return readTextBox(native, profile, glyphs)

  const changed = glyphs !== lastSentGlyphs
  if (changed) lastSentGlyphs = glyphs
  try {
    return await requestFromWorker(active, pendingReads, (sequence) => ({
      message: { kind: 'read', sequence, native, profile, glyphs: changed ? glyphs : undefined },
      transfer: [],
    }))
  } catch {
    // Either way, read the frame already in hand rather than losing the box. A dead worker also
    // resets `lastSentGlyphs`, since the next worker starts with no alphabet of its own yet.
    if (workerUnavailable) lastSentGlyphs = null
    return readTextBox(native, profile, glyphs)
  }
}

export async function encodeBox(native: ImageData): Promise<File> {
  const active = readWorker()
  if (active === null) return screenPng(native)

  try {
    const blob = await requestFromWorker(active, pendingEncodes, (sequence) => ({
      message: { kind: 'encode', sequence, native },
      transfer: [],
    }))
    // The name is a label only — `importDialogueMedia` derives the real one in `media/`.
    return new File([blob], 'capture.png', { type: 'image/png' })
  } catch {
    return screenPng(native)
  }
}

// Measured 110 ms on a 3840x2088 frame (`npm run bench:capture`), scaling with frame area — long
// enough that running it inline froze the calibration screen on every press of "Measure it".
export async function measureScreen(
  frame: ImageData,
  nativeWidth: number,
  nativeHeight: number,
): Promise<ScreenMeasurement> {
  const active = readWorker()
  if (active === null) return measureCalibration(frame, nativeWidth, nativeHeight)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(frame)
  } catch {
    return measureCalibration(frame, nativeWidth, nativeHeight)
  }

  try {
    return await requestFromWorker(active, pendingMeasures, (sequence) => ({
      message: { kind: 'calibrate', sequence, bitmap, nativeWidth, nativeHeight },
      transfer: [bitmap],
    }))
  } catch {
    return measureCalibration(frame, nativeWidth, nativeHeight)
  }
}

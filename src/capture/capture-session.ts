import { useSyncExternalStore } from 'react'
import type { Point, PixelRect } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'

// `requesting` is its own state rather than a boolean beside `idle` — the picker is modal and
// takes seconds, and a Connect button that stays pressable during it would race a second call.
export type CaptureSource =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'live'; label: string; frameWidth: number; frameHeight: number }
  | { kind: 'failed'; message: string }

type ConnectOutcome = 'connected' | 'cancelled' | 'failed'

// Mirrors `VIDEO_PROBE_TIMEOUT_MS` in `import-media.ts`: a source Chromium accepts but never
// produces a frame for leaves the element in `HAVE_NOTHING` with neither event ever firing.
const METADATA_TIMEOUT_MS = 10_000

// Shorter than the connect deadline, since the connection is already known good by then — this
// only fires when the source stopped producing frames (e.g. a minimised window).
const FRAME_TIMEOUT_MS = 5_000

const IDLE: CaptureSource = { kind: 'idle' }
const REQUESTING: CaptureSource = { kind: 'requesting' }

// Module-level, not component or store state: a `MediaStream` must survive switching dialogues and
// switching views, and it is neither serializable nor part of the document.
let state: CaptureSource = IDLE
const listeners = new Set<() => void>()

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let canvas: HTMLCanvasElement | null = null

export function getCaptureSource(): CaptureSource {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCaptureSource(): CaptureSource {
  return useSyncExternalStore(subscribe, getCaptureSource)
}

// Must be called from a click handler — `getDisplayMedia` requires transient user activation, the
// same rule as `requestPermission`. The picker runs **once**; every later `grabFrame` is a
// `drawImage` with no prompt.
export async function connectCaptureSource(): Promise<ConnectOutcome> {
  if (state.kind === 'requesting') return 'cancelled'

  // An earlier connection would otherwise keep its tracks and Chrome's sharing indicator alive
  // behind the new one.
  release()
  setState(REQUESTING)

  let picked: MediaStream
  try {
    picked = await navigator.mediaDevices.getDisplayMedia({
      // Matched to `POLL_MS` in `capture-watch.ts` — a still frame is all it reads, so a higher
      // rate would only cost encode work on the captured window.
      video: { frameRate: { ideal: 10 } },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    })
  } catch (error) {
    if (isCancellation(error)) {
      setState(IDLE)
      return 'cancelled'
    }
    setState({ kind: 'failed', message: describeError(error) })
    return 'failed'
  }

  try {
    await startPlaying(picked)
    return 'connected'
  } catch (error) {
    stopTracks(picked)
    setState({ kind: 'failed', message: describeError(error) })
    return 'failed'
  }
}

export function disconnectCaptureSource(): void {
  release()
  setState(IDLE)
}

type FrameCrop = {
  pixels: ImageData
  origin: Point
}

// `createImageBitmap(video, sx, sy, sw, sh)` cuts the frame where the browser can do it, so the
// whole surface is never drawn to a canvas.
export async function grabFrame(rect?: PixelRect): Promise<FrameCrop> {
  const { element, crop } = await readyCrop(rect)
  const bitmap = await createImageBitmap(element, crop.x, crop.y, crop.width, crop.height)
  try {
    const canvas = new OffscreenCanvas(crop.width, crop.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('This browser provided no 2D canvas context.')
    context.drawImage(bitmap, 0, 0)
    return { pixels: context.getImageData(0, 0, crop.width, crop.height), origin: { x: crop.x, y: crop.y } }
  } finally {
    bitmap.close()
  }
}

async function readyCrop(rect: PixelRect | undefined): Promise<{ element: HTMLVideoElement; crop: PixelRect }> {
  const element = video
  if (state.kind !== 'live' || element === null) {
    throw new Error('Connect a screen or window before capturing a frame.')
  }

  if (element.readyState < element.HAVE_CURRENT_DATA) {
    await waitForVideo(element, 'loadeddata', FRAME_TIMEOUT_MS, 'The capture source stopped sending frames.')
  }

  const frameWidth = element.videoWidth
  const frameHeight = element.videoHeight
  if (frameWidth === 0 || frameHeight === 0) throw new Error('The capture source has no frame yet.')

  const crop = rect === undefined ? { x: 0, y: 0, width: frameWidth, height: frameHeight } : growAndClamp(rect, frameWidth, frameHeight)
  return { element, crop }
}

// Grown by one pixel per side so nearest-neighbour sampling from a native pixel's centre near the
// rectangle's own edge cannot fall outside the crop.
function growAndClamp(rect: PixelRect, frameWidth: number, frameHeight: number): PixelRect {
  const left = Math.max(0, Math.floor(rect.x) - 1)
  const top = Math.max(0, Math.floor(rect.y) - 1)
  const right = Math.min(frameWidth, Math.ceil(rect.x + rect.width) + 1)
  const bottom = Math.min(frameHeight, Math.ceil(rect.y + rect.height) + 1)
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

// Calibration is minutes of dragging rectangles over a picture while the live source keeps
// moving, so the frame is copied out once and the rest of the work happens against a still.
export type FrozenFrame = {
  url: string
  width: number
  height: number
  // Carried rather than decoded back out of `url` on demand — a second decode could drift from
  // the one on screen.
  pixels: ImageData
}

export async function freezeFrame(): Promise<FrozenFrame> {
  const drawn = await drawCurrentFrame()
  // PNG, not JPEG — JPEG ringing around 8-pixel glyph edges would make a tile grid look misaligned.
  const blob = await new Promise<Blob | null>((resolve) => {
    drawn.canvas.toBlob(resolve, 'image/png')
  })
  if (blob === null) throw new Error('The captured frame could not be encoded.')
  return {
    url: URL.createObjectURL(blob),
    width: drawn.width,
    height: drawn.height,
    pixels: drawn.context.getImageData(0, 0, drawn.width, drawn.height),
  }
}

// Not ref-counted the way media URLs are — one owner, one revoke.
export function releaseFrozenFrame(frame: FrozenFrame): void {
  URL.revokeObjectURL(frame.url)
}

async function drawCurrentFrame(): Promise<{
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  width: number
  height: number
}> {
  const element = video
  if (state.kind !== 'live' || element === null) {
    throw new Error('Connect a screen or window before capturing a frame.')
  }

  if (element.readyState < element.HAVE_CURRENT_DATA) {
    await waitForVideo(element, 'loadeddata', FRAME_TIMEOUT_MS, 'The capture source stopped sending frames.')
  }

  const width = element.videoWidth
  const height = element.videoHeight
  if (width === 0 || height === 0) throw new Error('The capture source has no frame yet.')

  const context = frameContext(width, height)
  context.drawImage(element, 0, 0, width, height)
  return { canvas: context.canvas, context, width, height }
}

// Chromium's raw `track.label` is an identifier (`window:12345:0`), not a title, so the surface
// kind carries the meaning and the raw label only tells two windows apart.
export function describeCaptureSource(displaySurface: string | undefined, trackLabel: string): string {
  const surface = SURFACE_NAMES[displaySurface ?? ''] ?? 'Capture source'
  const raw = trackLabel.trim()
  return raw === '' ? surface : `${surface} · ${raw}`
}

const SURFACE_NAMES: Readonly<Record<string, string | undefined>> = {
  monitor: 'Screen',
  window: 'Window',
  browser: 'Browser tab',
}

async function startPlaying(picked: MediaStream): Promise<void> {
  const track = picked.getVideoTracks().at(0)
  if (track === undefined) throw new Error('The chosen source provided no video.')

  // Off-DOM, muted: a never-attached element that autoplays unmuted is blocked by autoplay policy.
  const element = document.createElement('video')
  element.muted = true
  element.playsInline = true

  try {
    element.srcObject = picked
    await waitForVideo(element, 'loadedmetadata', METADATA_TIMEOUT_MS, 'The capture source never started.')
    // Left playing for the session — a paused element holds one stale frame.
    await element.play()
  } catch (error) {
    releaseVideo(element)
    throw error
  }

  stream = picked
  video = element

  // Chrome's "Stop sharing" bar ends the track without telling the page anything else.
  track.addEventListener(
    'ended',
    () => {
      if (stream !== picked) return
      release()
      setState(IDLE)
    },
    { once: true },
  )

  // `surfaceSwitching: 'include'` lets the user swap surfaces mid-session, or resize the window.
  element.addEventListener('resize', () => {
    if (video !== element) return
    setState(liveState(element, track))
  })

  setState(liveState(element, track))
}

function liveState(element: HTMLVideoElement, track: MediaStreamTrack): CaptureSource {
  return {
    kind: 'live',
    label: describeCaptureSource(track.getSettings().displaySurface, track.label),
    frameWidth: element.videoWidth,
    frameHeight: element.videoHeight,
  }
}

// Does not contradict CLAUDE.md's "no `<canvas>`" rule — that's about rendering the map. Nothing
// is rendered here; a canvas is the only way to read pixels out of a `<video>`.
function frameContext(width: number, height: number): CanvasRenderingContext2D {
  canvas ??= document.createElement('canvas')
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  // Every frame here is read straight back with `getImageData` — the pattern this flag exists for.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('This browser provided no 2D canvas context.')
  return context
}

// Resolves on `event`, rejects on error or on a deadline so a stalled track can't hang forever.
function waitForVideo(
  element: HTMLVideoElement,
  event: 'loadedmetadata' | 'loadeddata',
  timeoutMs: number,
  message: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fail = (): void => {
      reject(new Error(message))
    }
    element.addEventListener(event, () => resolve(), { once: true })
    element.addEventListener('error', fail, { once: true })
    setTimeout(fail, timeoutMs)
  })
}

function release(): void {
  if (stream !== null) {
    stopTracks(stream)
    stream = null
  }
  if (video !== null) {
    releaseVideo(video)
    video = null
  }
}

function releaseVideo(element: HTMLVideoElement): void {
  element.pause()
  // Dropping the stream is what lets the track — and Chrome's capture indicator — go away.
  element.srcObject = null
}

function stopTracks(target: MediaStream): void {
  for (const track of target.getTracks()) track.stop()
}

// `NotAllowedError` covers dismissing the picker (indistinguishable from a policy refusal, so it
// must not read as an error); `AbortError` covers the source disappearing mid-pick.
function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

function setState(next: CaptureSource): void {
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

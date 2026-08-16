import { useSyncExternalStore } from 'react'
import { describeError } from '../storage/project-directory.ts'

/**
 * The live screen-capture connection, as the UI sees it.
 *
 * `requesting` is its own state rather than a boolean beside `idle`: the picker is modal and
 * takes seconds, and a Connect button that stays pressable during it would let a second call
 * race the first.
 */
export type CaptureSource =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'live'; label: string; frameWidth: number; frameHeight: number }
  | { kind: 'failed'; message: string }

/** What a Connect attempt did, so the caller can say "cancelled" without it being an error. */
export type ConnectOutcome = 'connected' | 'cancelled' | 'failed'

/**
 * How long to wait for the stream's first metadata before giving up.
 *
 * Mirrors `VIDEO_PROBE_TIMEOUT_MS` in `import-media.ts`, and for the same reason: a source that
 * Chromium accepts but never produces a frame for leaves the element in `HAVE_NOTHING` with
 * neither `loadedmetadata` nor `error` ever firing, and the promise would never settle.
 */
const METADATA_TIMEOUT_MS = 10_000

/**
 * How long `grabFrame` waits for the element to hold a decoded frame.
 *
 * Shorter than the connect deadline because the connection is already known good by then: this
 * only fires when the source stopped producing frames — a captured window minimised to the tray
 * — and a capture button that hangs for ten seconds reads as a broken app.
 */
const FRAME_TIMEOUT_MS = 5_000

/** Shared references, so an unchanged state keeps returning the identical snapshot. */
const IDLE: CaptureSource = { kind: 'idle' }
const REQUESTING: CaptureSource = { kind: 'requesting' }

// Module-level rather than component state: a `MediaStream` has to survive switching dialogues
// and switching to the quest board and back. Module-level rather than the store: it is neither
// serializable nor part of the document, which is the same call `project-directory.ts` makes
// for the directory handle.
let state: CaptureSource = IDLE
const listeners = new Set<() => void>()

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let canvas: HTMLCanvasElement | null = null

/** Passed to `useSyncExternalStore` by reference — a fresh object per call renders forever. */
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

/**
 * Opens the screen picker and keeps the resulting stream live for the rest of the session.
 *
 * Must be called from a click handler: `getDisplayMedia` requires transient user activation,
 * the same rule `CLAUDE.md` records for `requestPermission`. The picker therefore runs **once**
 * — every later `grabFrame` is a `drawImage` with no prompt at all.
 */
export async function connectCaptureSource(): Promise<ConnectOutcome> {
  // A second click while the picker is open cannot open a second picker — the first one owns
  // the activation — so nothing happens, which is what 'cancelled' says.
  if (state.kind === 'requesting') return 'cancelled'

  // An earlier connection would otherwise keep its tracks and Chrome's sharing indicator alive
  // behind the new one.
  release()
  setState(REQUESTING)

  let picked: MediaStream
  try {
    picked = await navigator.mediaDevices.getDisplayMedia({
      // A dialogue box is read off a still frame, so frames per second buys nothing and costs
      // encode work on the captured window for the whole session.
      video: { frameRate: { ideal: 5 } },
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

/** Stops sharing. Safe to call twice, and safe to call when nothing was ever connected. */
export function disconnectCaptureSource(): void {
  release()
  setState(IDLE)
}

/**
 * The current frame of the connected source, as pixels.
 *
 * The `<video>` is already playing, so this is a `drawImage` plus a `getImageData` — cheap
 * enough to press repeatedly, which is what appending line after line of a scrolling text box
 * will do.
 */
export async function grabFrame(): Promise<ImageData> {
  const drawn = await drawCurrentFrame()
  return drawn.context.getImageData(0, 0, drawn.width, drawn.height)
}

/**
 * One frame held still, as something an `<img>` can show.
 *
 * Calibration is minutes of dragging rectangles over a picture, and the live source keeps
 * moving underneath — an emulator does not pause because the app opened a panel. So the frame
 * is copied out once and the rest of the work happens against a still that cannot shift under
 * the rectangles already drawn on it.
 */
export type FrozenFrame = { url: string; width: number; height: number }

export async function freezeFrame(): Promise<FrozenFrame> {
  const drawn = await drawCurrentFrame()
  // PNG, not JPEG: a text box read at 1:1 is the whole point, and JPEG ringing around 8-pixel
  // glyph edges is exactly the artefact that would make a tile grid look misaligned.
  const blob = await new Promise<Blob | null>((resolve) => {
    drawn.canvas.toBlob(resolve, 'image/png')
  })
  if (blob === null) throw new Error('The captured frame could not be encoded.')
  return { url: URL.createObjectURL(blob), width: drawn.width, height: drawn.height }
}

/** Frozen frames are not ref-counted the way media URLs are — one owner, one revoke. */
export function releaseFrozenFrame(frame: FrozenFrame): void {
  URL.revokeObjectURL(frame.url)
}

/** The live element's current pixels, on the shared canvas. Both grab paths start here. */
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
  // `frameContext` created or resized it, so the module-level handle is the one just drawn to.
  return { canvas: context.canvas, context, width, height }
}

/**
 * A readable name for a captured surface.
 *
 * Chromium's raw `track.label` is an identifier (`window:12345:0`), not a title, so the surface
 * kind carries the meaning and the raw label is kept beside it only to tell two windows apart.
 */
export function describeCaptureSource(displaySurface: string | undefined, trackLabel: string): string {
  const surface = SURFACE_NAMES[displaySurface ?? ''] ?? 'Capture source'
  const raw = trackLabel.trim()
  return raw === '' ? surface : `${surface} · ${raw}`
}

/** `| undefined` on the value type because `noUncheckedIndexedAccess` is off — as in `import-media.ts`. */
const SURFACE_NAMES: Readonly<Record<string, string | undefined>> = {
  monitor: 'Screen',
  window: 'Window',
  browser: 'Browser tab',
}

async function startPlaying(picked: MediaStream): Promise<void> {
  const track = picked.getVideoTracks().at(0)
  if (track === undefined) throw new Error('The chosen source provided no video.')

  // Off-DOM, like `probeVideoSize`: nothing is ever attached to the document. Muted, because a
  // never-attached element that autoplays unmuted is blocked by the autoplay policy.
  const element = document.createElement('video')
  element.muted = true
  element.playsInline = true

  try {
    element.srcObject = picked
    await waitForVideo(element, 'loadedmetadata', METADATA_TIMEOUT_MS, 'The capture source never started.')
    // Left playing for the rest of the session: a paused element holds one stale frame, and
    // restarting playback per capture would cost more than the capture.
    await element.play()
  } catch (error) {
    releaseVideo(element)
    throw error
  }

  stream = picked
  video = element

  // Chrome's own "Stop sharing" bar ends the track without telling the page anything else. Read
  // here rather than at the next capture attempt, so the app is never wrong about being live.
  track.addEventListener(
    'ended',
    () => {
      if (stream !== picked) return
      release()
      setState(IDLE)
    },
    { once: true },
  )

  // `surfaceSwitching: 'include'` lets the user swap the shared surface mid-session, and a
  // captured window can simply be resized; either way the frame size on screen must follow.
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

/**
 * The pixel buffer every capture draws into, reused across captures.
 *
 * An off-DOM canvas does **not** contradict `CLAUDE.md`'s "no `<canvas>`" rule: that decision is
 * about rendering the map, which is DOM plus one inline `<svg>`. Nothing is rendered here — a
 * canvas is the only way to read pixels out of a `<video>`, and the next reader will check.
 */
function frameContext(width: number, height: number): CanvasRenderingContext2D {
  canvas ??= document.createElement('canvas')
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  // Every frame drawn here is read straight back with `getImageData`, which is the exact
  // access pattern this flag exists for.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('This browser provided no 2D canvas context.')
  return context
}

/**
 * Resolves on `event`, rejects on the element's own error, and rejects on a deadline so a
 * stalled track cannot hang the caller forever.
 */
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

/**
 * Dismissing the picker throws `NotAllowedError`, which is indistinguishable from a policy
 * refusal — and reading a dismissal as an error would put a red message on screen every time
 * the user changed their mind. `AbortError` covers the source disappearing mid-pick.
 */
function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

function setState(next: CaptureSource): void {
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

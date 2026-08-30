import { useSyncExternalStore } from 'react'
import { discardMediaFile } from '../media/discard-media.ts'
import { importDialogueMedia } from '../media/import-media.ts'
import { newPendingCaptureId } from '../project/ids.ts'
import { dispatch, getState } from '../project/store.ts'
import type {
  CaptureProfile,
  CaptureProfileId,
  DialogueMedia,
  Glyph,
  PendingCapture,
  PendingCaptureId,
  Point,
} from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { activeCaptureProfile } from './active-profile.ts'
import type { SettleState } from './box-settle.ts'
import { NOTHING_SEEN, boxReadingFrom, nextSettle } from './box-settle.ts'
import { getCaptureSource, grabFrame } from './capture-session.ts'
import { appendOutcome, captureBlocker, screenPng } from './capture-to-dialogue.ts'
import type { TextBoxReading, UnknownTile } from './glyph-matcher.ts'
import { readTextBox } from './glyph-matcher.ts'
import { middleAddsNothing } from './middle-frame.ts'

// Module-level, not component or store state: this loop must outlive `DialoguePanel` unmounting,
// and it is neither serialisable nor part of the document.

// `off.message` is set when the watcher stopped itself (e.g. the emulator window was minimised).
export type WatchState =
  | { kind: 'off'; message: string | null }
  | {
      kind: 'watching'
      // `null` until the first settled box creates one; published only via `setCurrentCaptureId`.
      captureId: PendingCaptureId | null
      appended: number
      repeated: number
      dropped: number
      conversations: number
      lastText: string | null
      paused: string | null
      lastReadAt: number | null
    }

// Carries `captureId` because a held frame belongs to whichever capture was being recorded when it
// was read, never to whatever the watcher is recording into when it is later replayed.
type HeldFrame = { captureId: PendingCaptureId; frame: ImageData; origin: Point }

type HeldState = {
  waiting: number
  dropped: number
}

type HeldReplay = {
  appended: number
  gone: number
  stillHeld: number
  repeated: number
  dropped: number
  failures: readonly string[]
}

// Matches `frameRate: { ideal: 10 }` in `connectCaptureSource` — polling faster would just re-read
// the same source frame.
const POLL_MS = 100

// Three ticks at 100ms; `autosave-decision.ts`'s "every 600 ms" settle-cadence note assumes this value.
const SETTLE_TICKS = 3

// A single hiccup shouldn't end a conversation, but a minimised window stops producing frames for good.
const FAILURES_BEFORE_STOP = 3

// The oldest is dropped past this — the newest frames are the ones the player can still remember.
const HELD_LIMIT = 24

const OFF: WatchState = { kind: 'off', message: null }
const NOTHING_HELD: HeldState = { waiting: 0, dropped: 0 }

let state: WatchState = OFF
let held: HeldState = NOTHING_HELD
// Not in `HeldState`: a snapshot React compares by identity has no business carrying pixels around.
let heldFrames: HeldFrame[] = []
const listeners = new Set<() => void>()

// Bumped by every start and stop, so work resuming after an `await` can tell it was cancelled.
let session = 0
let timer: ReturnType<typeof setTimeout> | null = null
let settle: SettleState = NOTHING_SEEN

// A box is only "already written" for the profile it was read under — a different profile can
// read the same pixels differently.
let settledFor: { profileId: CaptureProfileId | null } = { profileId: null }

let currentCaptureId: PendingCaptureId | null = null

// The one place `currentCaptureId` changes, so `WatchState.captureId` can never disagree with it.
function setCurrentCaptureId(id: PendingCaptureId | null): void {
  currentCaptureId = id
  if (state.kind === 'watching' && state.captureId !== id) setState({ ...state, captureId: id })
}

let failures = 0
// Whether `replayHeldFrames` is writing. The tick stands down rather than interleaving with it.
let replaying = false

// The read runs off the main thread when a worker is available, falling back to the same
// `readTextBox` this file calls inline when it is not. Only the tick uses the worker — a manual
// press keeps reading on the main thread since its frame is handed back for further main-thread reads.

type WorkerResponse =
  | { kind: 'read'; sequence: number; reading: TextBoxReading }
  | { kind: 'encoded'; sequence: number; blob: Blob }
  | { kind: 'error'; sequence: number; message: string }

const WORKER_READ_TIMEOUT_MS = 5_000

let worker: Worker | null = null
// Sticky for the session once a worker fails to start or crashes — see `readWorker`.
let workerUnavailable = false
let nextRequestSequence = 0

type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const pendingReads = new Map<number, Pending<TextBoxReading>>()
const pendingEncodes = new Map<number, Pending<Blob>>()

// The alphabet last **sent** to the worker, by reference. `postMessage` structured-clones its
// payload, so sending `glyphs` on every tick would defeat `readTextBox`'s identity-keyed caches
// inside the worker; `readBox` sends it again only when this reference has moved.
let lastSentGlyphs: readonly Glyph[] | null = null

// Created lazily on the first read and kept for the session — `stopRecording` does not tear it
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
    }
    created.onerror = () => {
      workerUnavailable = true
      worker = null
      failAll(pendingReads)
      failAll(pendingEncodes)
    }
    worker = created
    return created
  } catch {
    workerUnavailable = true
    return null
  }
}

// `sequence` is a single counter shared by both request kinds, so it names at most one pending
// entry across the two maps — a lookup in the wrong map simply misses.
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

// `frame` stays on the main thread either way; only a bitmap derived from it is transferred, so
// the worker never needs the canonical pixels handed back.
async function readBox(
  frame: ImageData,
  origin: Point,
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
): Promise<TextBoxReading> {
  const active = readWorker()
  if (active === null) return readTextBox(frame, profile, glyphs, origin)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(frame)
  } catch {
    return readTextBox(frame, profile, glyphs, origin)
  }

  const changed = glyphs !== lastSentGlyphs
  if (changed) lastSentGlyphs = glyphs
  try {
    return await requestFromWorker(active, pendingReads, (sequence) => ({
      message: { kind: 'read', sequence, bitmap, origin, profile, glyphs: changed ? glyphs : undefined },
      transfer: [bitmap],
    }))
  } catch {
    // Either way, read the frame already in hand rather than losing the box. A dead worker also
    // resets `lastSentGlyphs`, since the next worker starts with no alphabet of its own yet.
    if (workerUnavailable) lastSentGlyphs = null
    return readTextBox(frame, profile, glyphs, origin)
  }
}

async function encodeBox(frame: ImageData, origin: Point, profile: CaptureProfile): Promise<File> {
  const active = readWorker()
  if (active === null) return screenPng(frame, profile, origin)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(frame)
  } catch {
    return screenPng(frame, profile, origin)
  }

  try {
    const blob = await requestFromWorker(active, pendingEncodes, (sequence) => ({
      message: { kind: 'encode', sequence, bitmap, origin, profile },
      transfer: [bitmap],
    }))
    // The name is a label only — `importDialogueMedia` derives the real one in `media/`.
    return new File([blob], 'capture.png', { type: 'image/png' })
  } catch {
    return screenPng(frame, profile, origin)
  }
}

type WrittenFrame = { media: DialogueMedia; text: string }

// The last two boxes written for each capture, oldest first — the window `middleAddsNothing`
// judges a middle in. Keyed by capture because two captures can write concurrently, and a shared
// window couldn't tell an entry belonging to one from a write racing in from the other.
const writtenByCapture = new Map<PendingCaptureId, WrittenFrame[]>()

// Passed to `useSyncExternalStore` by reference — a fresh object per call renders forever.
function getWatchState(): WatchState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useWatchState(): WatchState {
  return useSyncExternalStore(subscribe, getWatchState)
}

// On its own subscription, mirroring `useSaveState`: a watcher reading ten times a second changes
// its counters constantly, and the toggle has no business re-rendering for that.
export function useWatching(): boolean {
  return useSyncExternalStore(subscribe, isWatching)
}

function isWatching(): boolean {
  return state.kind === 'watching'
}

// On its own subscription — the queue outlives the watcher being switched off, since the alphabet
// is usually answered once the conversation is over.
export function useHeldFrames(): HeldState {
  return useSyncExternalStore(subscribe, getHeld)
}

function getHeld(): HeldState {
  return held
}

// `'extend'` reopens `pendingCaptures.at(-1)` untouched rather than re-creating; with an empty
// queue it behaves like `'new'`. Already recording is a no-op — a recording in progress reads
// either trigger as Stop, so nothing calls this while `state.kind === 'watching'` (see `CaptureRecorder`).
function startRecording(mode: 'new' | 'extend'): void {
  if (state.kind === 'watching') return
  session += 1
  settle = NOTHING_SEEN
  settledFor = { profileId: null }
  currentCaptureId = null
  writtenByCapture.clear()
  failures = 0
  // The held queue is deliberately not cleared — it survives the watcher being switched off and on.
  setState({
    kind: 'watching',
    captureId: null,
    appended: 0,
    repeated: 0,
    dropped: 0,
    conversations: 0,
    lastText: null,
    paused: null,
    lastReadAt: null,
  })
  if (mode === 'extend') {
    const app = getState()
    const pendingCaptures = app.kind === 'ready' ? app.project.pendingCaptures : []
    setCurrentCaptureId(pendingCaptures.at(-1)?.id ?? null)
  }
  schedule(session)
}

// Unconditional: the connection can end while the loop runs, and a recording that could refuse to
// stop would have no way back. `writeQueues` is deliberately left alone — a box settled just
// before Stop can still be mid-encode or mid-write, and it drains on its own rather than being cancelled.
function stopRecording(): void {
  stopWith(null)
}

function stopWith(message: string | null): void {
  session += 1
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  setState(message === null ? OFF : { kind: 'off', message })
}

// The one rule both `CaptureRecorder`'s buttons and a bound gamepad button trigger through, so a
// controller press can never disagree with the button beside it.
export function triggerRecording(mode: 'new' | 'extend'): void {
  if (state.kind === 'watching') {
    stopRecording()
    return
  }
  const app = getState()
  if (app.kind !== 'ready') return
  const profile = activeCaptureProfile(app.project.captureProfiles)
  if (captureBlocker(getCaptureSource(), profile) === null) startRecording(mode)
}

// Scheduled only after the previous tick finished, not on an interval — a tick that writes a
// picture into `media/` can outlast `POLL_MS`, and overlapping ticks would race each other's append.
function schedule(mine: number): void {
  timer = setTimeout(() => {
    void run(mine)
  }, POLL_MS)
}

async function run(mine: number): Promise<void> {
  timer = null
  if (mine !== session) return
  try {
    await tick(mine)
  } catch (error) {
    // Backstop for anything `tick` doesn't handle itself, so a bad frame doesn't become a silent
    // unhandled rejection every 100 ms while the loop keeps going as if it were reading.
    if (mine === session) pause(describeError(error))
  } finally {
    if (mine === session) schedule(mine)
  }
}

async function tick(mine: number): Promise<void> {
  const app = getState()
  if (app.kind !== 'ready') {
    pause('Open a project folder — a captured line is written into the project it belongs to.')
    return
  }

  const profile = activeCaptureProfile(app.project.captureProfiles)
  const blocker = captureBlocker(getCaptureSource(), profile)
  if (blocker !== null || profile === null) {
    pause(blocker ?? 'Calibrate a capture profile below.')
    return
  }

  // A replay writes the held queue frame by frame; reading on underneath it would interleave two
  // writers into one capture and put boxes into it out of order.
  if (replaying) {
    pause('Writing the boxes that were waiting for the alphabet.')
    return
  }

  // Both halves are load-bearing: a text field anywhere can stay `document.activeElement` long
  // after losing real focus, so without `document.hasFocus()` the loop would pause for the rest of
  // the session the moment a field was last clicked into.
  if (document.hasFocus() && isTextFieldFocused()) {
    pause('Holding while you type. Click back into the game and it carries on.')
    return
  }

  // A profile switched mid-conversation can read the same pixels differently; the capture being
  // written into is unaffected, since that's whatever `startRecording` opened.
  if (profile.id !== settledFor.profileId) {
    settle = NOTHING_SEEN
    settledFor = { profileId: profile.id }
  }

  let frame: ImageData
  let origin: Point
  try {
    const grabbed = await grabFrame(profile.screenRect)
    frame = grabbed.pixels
    origin = grabbed.origin
  } catch (error) {
    // A grab can wait seconds for a frame that never comes; a deliberate Stop that bumped the
    // session must not be overwritten by its rejection.
    if (mine !== session) return
    failures += 1
    if (failures >= FAILURES_BEFORE_STOP) stopWith(describeError(error))
    else pause(describeError(error))
    return
  }
  if (mine !== session) return
  failures = 0

  const glyphs = app.project.glyphs
  const reading = await readBox(frame, origin, profile, glyphs)
  // A worker round trip is an await like any other; a reply arriving after a stop/start/profile
  // switch bumped the session must not be acted on.
  if (mine !== session) return
  const step = nextSettle(settle, boxReadingFrom(reading), SETTLE_TICKS)
  settle = step.state
  markRead()

  const settled = step.settled
  if (settled === null) return

  // A held frame can only be appended at the *end* of a capture, so an unreadable box — or a
  // readable one arriving behind one still waiting — holds with the capture in progress rather
  // than writing out of order. A capture not yet open has nowhere for the frame to wait, so the
  // box is simply not captured.
  if (currentCaptureId !== null && (settled.kind === 'held' || holdsFrameFor(currentCaptureId))) {
    hold(currentCaptureId, frame, origin)
    return
  }
  if (settled.kind === 'held') return

  writeIntoQueue(profile, frame, origin, settled.text)
}

// Synchronous, and deliberately not awaited by the tick: resolving *which* capture this box
// belongs to must happen now, before the next tick reads `currentCaptureId`, but the encode and
// disk write do not — queuing them lets `schedule` arm the next poll immediately.
function writeIntoQueue(
  profile: CaptureProfile,
  frame: ImageData,
  origin: Point,
  transcript: string,
): void {
  if (currentCaptureId !== null && currentPendingCapture(currentCaptureId) === null) {
    // Placed or deleted since the last tick. Not 'gone' — the conversation itself is not gone,
    // only the capture that was holding it; falling through starts a fresh one for this box.
    setCurrentCaptureId(null)
  }

  if (currentCaptureId === null) openCapture()
  const captureId = currentCaptureId
  // `openCapture` only ever leaves this null with no project open, which the tick already refused.
  if (captureId === null) return

  queueWrite(captureId, profile, frame, origin, transcript)
}

// One FIFO chain per capture, run in order — `appendWithoutOverlap` joins a scrolled box to the
// suffix before it, so out-of-order writes would join it to the wrong one. Different captures'
// chains run concurrently and never wait on each other.
const writeQueues = new Map<PendingCaptureId, Promise<void>>()

// Queues a write onto `captureId`'s chain and returns immediately; a failure here doesn't break
// the chain for boxes queued after it.
function queueWrite(
  captureId: PendingCaptureId,
  profile: CaptureProfile,
  frame: ImageData,
  origin: Point,
  transcript: string,
): void {
  const previous = writeQueues.get(captureId) ?? Promise.resolve()
  const next = previous.then(async () => {
    try {
      switch (await writeIntoCapture(captureId, profile, frame, origin, transcript)) {
        case 'appended':
          bump('appended', transcript)
          break
        case 'unchanged':
          bump('repeated')
          break
        case 'gone':
          break
      }
    } catch (error) {
      pause(describeError(error))
    }
  })
  writeQueues.set(captureId, next)
}

function openCapture(): void {
  const app = getState()
  const pendingCaptures = app.kind === 'ready' ? app.project.pendingCaptures : []
  const capture: PendingCapture = {
    id: newPendingCaptureId(),
    // Only a handle — a capture is identified by its first line and its picture, not its name.
    npcName: nextCaptureName(pendingCaptures),
    text: '',
    media: [],
    spokenAt: new Date().toISOString(),
    relevance: [],
  }
  dispatch({ kind: 'pending-capture/added', capture })
  setCurrentCaptureId(capture.id)
  bump('conversations')
}

function currentPendingCapture(id: PendingCaptureId): PendingCapture | null {
  const app = getState()
  if (app.kind !== 'ready') return null
  return app.project.pendingCaptures.find((capture) => capture.id === id) ?? null
}

function nextCaptureName(existing: readonly PendingCapture[]): string {
  const used = new Set(existing.map((capture) => capture.npcName))
  let n = 1
  while (used.has(`NPC ${n}`)) n += 1
  return `NPC ${n}`
}

// Never opens or bootstraps a capture — `captureId` already names one, live or held. Reads the
// document as it stands **now**, never a copy taken before an await, since a settled box is
// written well after the tick that read it began. `unchanged` writes nothing at all: a box saying
// nothing new is the ordinary case for a loop reading ten times a second, and this is the only
// caller allowed to judge a frame by outcome rather than by a deliberate press.
async function writeIntoCapture(
  captureId: PendingCaptureId,
  profile: CaptureProfile,
  frame: ImageData,
  origin: Point,
  transcript: string,
): Promise<'appended' | 'unchanged' | 'gone'> {
  const target = currentPendingCapture(captureId)
  if (target === null) return 'gone'
  if (appendOutcome(target.text, transcript).text !== 'appended') return 'unchanged'

  const { media } = await importDialogueMedia(captureId, await encodeBox(frame, origin, profile))
  dispatch({ kind: 'pending-capture/media-added', captureId, media })

  // Re-reads the document: encoding and writing the picture takes long enough for the capture to
  // have been placed or deleted underneath this write.
  const into = currentPendingCapture(captureId)
  if (into === null) {
    await discardMediaFile(media.file.fileName)
    return 'gone'
  }

  const outcome = appendOutcome(into.text, transcript)
  if (outcome.text !== 'appended') return 'unchanged'
  dispatch({ kind: 'pending-capture/text-set', captureId, text: outcome.next })
  await keepWindow(captureId, media, transcript)
  return 'appended'
}

// Slides the window on by one box, taking back the picture it pushes out of the middle. Here
// rather than in the tick, so a replayed frame is judged exactly as a live one, through
// `writeIntoCapture`. `before` is empty for the first pair, which `middleAddsNothing` reads as a
// filling box rather than a scrolling one.
async function keepWindow(
  captureId: PendingCaptureId,
  media: DialogueMedia,
  text: string,
): Promise<void> {
  const previous = writtenByCapture.get(captureId) ?? []
  const middle = previous.at(-1) ?? null
  const before = previous.at(-2)?.text ?? ''
  const entry: WrittenFrame = { media, text }

  if (middle !== null && middleAddsNothing(before, middle.text, text)) {
    // Written before the await, so a write landing underneath this one can't judge the same middle twice.
    writtenByCapture.set(captureId, [...previous.slice(0, -1), entry])
    await takeBack(captureId, middle.media)
    return
  }
  writtenByCapture.set(captureId, [...previous, entry].slice(-2))
}

// Document first, file after — the same order as the panel's own remove. The `target.media.some`
// check guards against a picture the user already removed by hand, or a capture placed/deleted meanwhile.
async function takeBack(captureId: PendingCaptureId, media: DialogueMedia): Promise<void> {
  const target = currentPendingCapture(captureId)
  if (target === null || !target.media.some((candidate) => candidate.id === media.id)) return
  dispatch({ kind: 'pending-capture/media-removed', captureId, mediaId: media.id })
  await discardMediaFile(media.file.fileName)
  bump('dropped')
}

// Whole-second resolution deliberately — at `POLL_MS` an exact stamp would publish a new state ten
// times a second for a line that changes once a second at most.
function markRead(): void {
  if (state.kind !== 'watching') return
  const at = Date.now()
  const same = state.lastReadAt !== null && Math.floor(at / 1000) === Math.floor(state.lastReadAt / 1000)
  if (same && state.paused === null) return
  setState({ ...state, paused: null, lastReadAt: at })
}

/** `lastText` only accompanies `'appended'` — the other three counters don't touch it. */
function bump(counter: 'repeated' | 'dropped' | 'appended' | 'conversations', lastText?: string): void {
  if (state.kind !== 'watching') return
  setState({
    ...state,
    [counter]: state[counter] + 1,
    ...(lastText !== undefined ? { lastText } : {}),
  })
}

function hold(captureId: PendingCaptureId, frame: ImageData, origin: Point): void {
  heldFrames.push({ captureId, frame, origin })
  let dropped = held.dropped
  while (heldFrames.length > HELD_LIMIT) {
    heldFrames.shift()
    dropped += 1
  }
  setHeld({ waiting: heldFrames.length, dropped })
}

function holdsFrameFor(captureId: PendingCaptureId): boolean {
  return heldFrames.some((entry) => entry.captureId === captureId)
}

// Deduplicated by bitmap across the whole queue, not per frame — three held boxes of the same
// conversation ask about one `e`, not three.
export function heldUnknownTiles(profile: CaptureProfile, glyphs: readonly Glyph[]): UnknownTile[] {
  const tiles: UnknownTile[] = []
  const seen = new Set<string>()
  for (const entry of heldFrames) {
    for (const tile of readTextBox(entry.frame, profile, glyphs, entry.origin).unknown) {
      if (seen.has(tile.bits)) continue
      seen.add(tile.bits)
      tiles.push(tile)
    }
  }
  return tiles
}

// Re-reads every held frame in **capture order** with the grown alphabet — out of order,
// `appendWithoutOverlap` would join a scrolled box to the wrong suffix.
export async function replayHeldFrames(
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
): Promise<HeldReplay> {
  // A snapshot to walk, while `heldFrames` stays the truth — an entry leaves the queue only once
  // written or dropped, so a throw anywhere below loses nothing.
  const pending = [...heldFrames]
  const replay = {
    appended: 0,
    gone: 0,
    stillHeld: 0,
    repeated: 0,
    dropped: held.dropped,
    failures: [] as string[],
  }
  // Cleared here because this round is the acknowledgement.
  setHeld({ waiting: heldFrames.length, dropped: 0 })
  // The tick stands down for the duration — two writers appending to one capture would interleave the boxes.
  replaying = true

  try {
    await replayInto(pending, profile, glyphs, replay)
  } finally {
    replaying = false
  }

  return replay
}

async function replayInto(
  pending: readonly HeldFrame[],
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
  replay: { appended: number; gone: number; stillHeld: number; repeated: number; failures: string[] },
): Promise<void> {
  // Captures with a frame left behind in this round — everything after it waits, or it would append out of order.
  const blocked = new Set<PendingCaptureId>()

  for (const entry of pending) {
    if (currentPendingCapture(entry.captureId) === null) {
      release(entry)
      replay.gone += 1
      continue
    }
    const reading = readTextBox(entry.frame, profile, glyphs, entry.origin)
    if (reading.unknown.length > 0 || blocked.has(entry.captureId)) {
      blocked.add(entry.captureId)
      replay.stillHeld += 1
      continue
    }
    try {
      const written = await writeIntoCapture(entry.captureId, profile, entry.frame, entry.origin, reading.text)
      release(entry)
      if (written === 'appended') {
        replay.appended += 1
        bump('appended', reading.text)
      } else if (written === 'gone') {
        replay.gone += 1
      } else {
        // Not counted as written: a held box can only append at the end of the conversation, and
        // `appendWithoutOverlap` swallowing it there needs to be told to the reader, not left silent.
        replay.repeated += 1
      }
    } catch (error) {
      // Kept, not dropped — the frame is still the only record of that box, and the boxes behind
      // it in the same capture wait with it so a retry writes them in order.
      blocked.add(entry.captureId)
      replay.failures.push(describeError(error))
    }
  }
}

// The frames are the only record of those boxes, so this is the single place the watcher loses
// data on purpose — the panel confirms before calling it.
export function discardHeldFrames(): number {
  const waiting = heldFrames.length
  heldFrames = []
  setHeld(NOTHING_HELD)
  return waiting
}

function release(entry: HeldFrame): void {
  heldFrames = heldFrames.filter((candidate) => candidate !== entry)
  setHeld({ waiting: heldFrames.length, dropped: held.dropped })
}

/** What a round of replaying leaves on screen. Every outcome is named; nothing goes quiet. */
export function describeReplay(replay: HeldReplay): string {
  const parts = [
    replay.appended === 1 ? '1 held box was written' : `${replay.appended} held boxes were written`,
  ]
  if (replay.gone > 0) {
    parts.push(`${replay.gone} belonged to a capture that no longer exists and were dropped`)
  }
  if (replay.stillHeld > 0) {
    parts.push(`${replay.stillHeld} still hold tiles the alphabet cannot name, and are kept`)
  }
  if (replay.repeated > 0) {
    parts.push(
      `${replay.repeated} said only what the capture already said, and were not written — a held ` +
        'box is appended at the end of the capture, not back in its place',
    )
  }
  if (replay.dropped > 0) {
    parts.push(`${replay.dropped} had already been pushed out of the queue and are lost`)
  }
  const failures = replay.failures.length === 0 ? '' : ` ${replay.failures.join(' ')}`
  return `${parts.join(', ')}.${failures}`
}

function setHeld(next: HeldState): void {
  if (next.waiting === held.waiting && next.dropped === held.dropped) return
  held = next
  for (const listener of listeners) listener()
}

function pause(reason: string): void {
  if (state.kind !== 'watching' || state.paused === reason) return
  setState({ ...state, paused: reason })
}

function setState(next: WatchState): void {
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

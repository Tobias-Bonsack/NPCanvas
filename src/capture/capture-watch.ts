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

// Logging a line without leaving the game.
//
// The capture connection is live for the whole session — `getDisplayMedia` ran once, and every
// frame afterwards is a `drawImage` with no prompt — so the pixels are available continuously,
// including while the emulator holds the OS focus and the page sees no key events at all. What was
// missing was only something to decide *when* a frame is worth reading, which `box-settle.ts`
// answers and this loop asks ten times a second.
//
// Module-level rather than component state, for the same reason `capture-session.ts` and
// `active-profile.ts` are: the loop has to outlive `DialoguePanel` unmounting, which switching to
// the quest board does. Module-level rather than store state, for the same reason again: it is
// neither serialisable nor part of the document.
//
// The watcher writes only into the pending-capture queue — `mapId`, `position` and `npcName` are
// knowledge only the player has, and inventing them badly is worse than asking, so a capture stays
// unplaced until the player places it (`pending-capture/placed`).
//
// Recording starts and stops on the player's own two triggers, `startRecording(mode)` and
// `stopRecording()` (#107), never on a guess: the watcher used to decide for itself where a
// conversation ended (a run of silent polls) and what it was writing into (whatever was selected),
// and both guesses had to be tuned or could be changed by an unrelated click. `'new'` always opens a
// fresh capture; `'extend'` reopens `pendingCaptures.at(-1)`, because a shopkeeper's second line or
// the sentence after a fight is the same conversation picked back up, not a new one. Either trigger
// fired while a recording runs stops it — two presses are a conversation, and the second press is
// wherever the player already is. There is deliberately no keyboard trigger: the hand that needs
// this is on a controller, and that binding is #110/#111.

/**
 * The watcher as the panel shows it.
 *
 * `off` carries a message when the watcher stopped itself, so a play session that ended because
 * the emulator window was minimised says so rather than simply having gone quiet.
 */
export type WatchState =
  | { kind: 'off'; message: string | null }
  | {
      kind: 'watching'
      /**
       * The capture being written into: `null` until the first settled box creates one (`'new'`),
       * or the reopened capture's own id from the moment `'extend'` started it. Published from the
       * one place that changes it (`setCurrentCaptureId`), so a reader of this state — #108's
       * carousel included — can never disagree with what the watcher is actually doing.
       */
      captureId: PendingCaptureId | null
      /** Boxes written into a line since the watcher was switched on. */
      appended: number
      /**
       * Boxes that came to rest saying only what the line already says, and were therefore not
       * written. Usually a box read again after the game paused on it; occasionally a sentence an
       * NPC genuinely repeats, which `appendWithoutOverlap` cannot tell apart from the first one.
       */
      repeated: number
      /**
       * Pictures the watcher wrote and then took back: a box in the middle of a scrolling run
       * whose text turned out to lie wholly under the two boxes around it — see `middle-frame.ts`.
       * Counted rather than done quietly, because a picture disappearing from the list is exactly
       * the kind of thing that has to be explained where it happens.
       */
      dropped: number
      /**
       * Conversations recorded into the pending-capture queue since the watcher was switched on —
       * one per `pending-capture/added`, never per box. A `'new'` recording eventually creates one;
       * an `'extend'` recording that finds a capture to reopen does not.
       */
      conversations: number
      /** The last line written, so the panel can be checked out of the corner of the eye. */
      lastText: string | null
      /** Why this tick read nothing, in a sentence naming the fix. `null` while it is reading. */
      paused: string | null
      /** `Date.now()` of the last frame that was read, or `null` before the first. */
      lastReadAt: number | null
    }

/**
 * A box the watcher read but could not transcribe, kept until the alphabet can name it.
 *
 * The frame is carried rather than the reading, because learning a tile has to transcribe *that*
 * frame again — and `writeIntoCapture` takes a frame, so a held one replays through the ordinary
 * path with nothing special about it.
 *
 * The `captureId` is carried because the alphabet may be completed long after the player has
 * moved on: a held frame belongs to the **capture that was being recorded when it was read**
 * (#109), never to whatever the watcher happens to be recording into when it is replayed —
 * `dialogueId` was the pre-#107 shape, back when the watcher wrote into a selected line.
 */
export type HeldFrame = { captureId: PendingCaptureId; frame: ImageData; origin: Point }

/** The queue, as the panel shows it. Its own snapshot, because it outlives the watcher being off. */
export type HeldState = {
  waiting: number
  /** Frames the cap pushed out. Surfaced rather than silently discarded; cleared by a replay. */
  dropped: number
}

/** What one round of answering the learner did. */
export type HeldReplay = {
  appended: number
  /** Frames whose capture no longer exists. Dropped with their entry rather than written elsewhere. */
  gone: number
  /** Frames the grown alphabet still cannot read whole. They stay in the queue. */
  stillHeld: number
  /** Frames whose box says only what the capture already says — see `replayInto`. */
  repeated: number
  /** Frames the cap had already pushed out before this round. */
  dropped: number
  /** What went wrong writing a frame, if anything. Those frames stay in the queue too. */
  failures: readonly string[]
}

/**
 * How often the box is read. Fast enough that a line is never on screen without being seen —
 * matched to `frameRate: { ideal: 10 }` in `connectCaptureSource` (`capture-session.ts`), since
 * polling faster than the source itself produces frames would just re-read the same one.
 */
const POLL_MS = 100

/**
 * How many identical readings make a box settled — see `box-settle.ts`.
 *
 * Three at 100 ms is three tenths of a second of stillness — half what it was before `POLL_MS`
 * dropped from 200: kept at three ticks rather than doubled to six, so a box now has to hold
 * still for less time before it settles. `autosave-decision.ts`'s "every 600 ms" reasoning about
 * the watcher's own settle cadence no longer holds at this value; see the comment there.
 */
const SETTLE_TICKS = 3

/**
 * Frame grabs in a row that end the session. A captured window minimised to the tray stops
 * producing frames for good, while a single hiccup is not worth ending a conversation over.
 */
const FAILURES_BEFORE_STOP = 3

/**
 * How many held frames the queue keeps at once. The oldest is dropped past this, because the
 * queue is replayed in capture order and the newest frames are the ones whose conversation the
 * player can still remember.
 */
const HELD_LIMIT = 24

const OFF: WatchState = { kind: 'off', message: null }
const NOTHING_HELD: HeldState = { waiting: 0, dropped: 0 }

let state: WatchState = OFF
let held: HeldState = NOTHING_HELD
// The frames themselves, in capture order. Not in `HeldState`: a snapshot React compares by
// identity has no business carrying megabytes of pixels around.
let heldFrames: HeldFrame[] = []
const listeners = new Set<() => void>()

/**
 * Which run of the loop is current. Bumped by every start and stop, so work that resumes after an
 * `await` can tell it was cancelled while it was suspended.
 */
let session = 0
let timer: ReturnType<typeof setTimeout> | null = null
let settle: SettleState = NOTHING_SEEN

/** What `settle` describes, as a key `===`-comparable across ticks. A box is only "already
 * written" for the profile it was read under — a different profile can read the same pixels
 * differently. */
let settledFor: { profileId: CaptureProfileId | null } = { profileId: null }

/**
 * The queue's conversation in progress, or `null` between conversations — `null` until the first
 * settled box of a `'new'` recording creates one, or from the start for an `'extend'` recording
 * that found nothing to reopen. Set only through `setCurrentCaptureId`, which is also what keeps
 * `WatchState`'s own `captureId` from disagreeing with it.
 */
let currentCaptureId: PendingCaptureId | null = null

/**
 * The one place `currentCaptureId` changes. Every assignment goes through this rather than the
 * bare variable, so `WatchState.captureId` can never publish something other than what the watcher
 * is actually about to write into next — the guarantee #108's carousel is built on.
 */
function setCurrentCaptureId(id: PendingCaptureId | null): void {
  currentCaptureId = id
  if (state.kind === 'watching' && state.captureId !== id) setState({ ...state, captureId: id })
}

let failures = 0
/** Whether `replayHeldFrames` is writing. The tick stands down rather than interleaving with it. */
let replaying = false

// #117: the read runs off the main thread when a worker is available, falling back to the same
// `readTextBox` this file already called inline when it is not. Only the tick uses the worker —
// `readLiveBox` (a manual press) keeps reading on the main thread, because its own frame is
// handed back to `DialoguePanel`/`CaptureBar` for further main-thread reads (see #112's own note
// on why that path stays whole-frame and synchronous).

type WorkerResponse =
  | { kind: 'read'; sequence: number; reading: TextBoxReading }
  | { kind: 'encoded'; sequence: number; blob: Blob }
  | { kind: 'error'; sequence: number; message: string }

/** How long a request may go unanswered before the caller gives up on the worker for it. */
const WORKER_READ_TIMEOUT_MS = 5_000

let worker: Worker | null = null
/** Set once a worker has failed to start or has crashed. Sticky for the session — see `readWorker`. */
let workerUnavailable = false
let nextRequestSequence = 0

type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const pendingReads = new Map<number, Pending<TextBoxReading>>()
const pendingEncodes = new Map<number, Pending<Blob>>()

/**
 * The alphabet last **sent** to the worker, by reference. `postMessage` structured-clones its
 * payload, so sending `glyphs` on every tick would hand the worker's own `readTextBox` a fresh
 * array every time and defeat #114's and #115's identity-keyed caches from inside the very thread
 * built to make them cheap. `readBox` sends it again only when this reference has moved.
 */
let lastSentGlyphs: readonly Glyph[] | null = null

/**
 * The shared worker, created lazily on the first read and kept for the rest of the session —
 * `stopRecording` does not tear it down, because a manual capture can still reach for it later.
 * Once unavailable it stays that way: the fallback is a deliberate, permanent choice for the
 * session rather than something retried every tick.
 */
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

/**
 * Routes one response to the pending request it answers, in whichever of the two maps holds it —
 * `sequence` is a single counter shared by both request kinds, so it names at most one pending
 * entry across them. A `kind` that does not belong to this map (a `'read'` response checked
 * against `pendingEncodes`, say) is `undefined` from `value`, which `resolve` never sees because
 * the `pending` lookup itself already missed for the wrong map.
 */
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

/** A request to a worker request, with the shared timeout/fallback plumbing factored out. */
async function requestFromWorker<T>(
  active: Worker,
  pending: Map<number, Pending<T>>,
  build: (sequence: number) => WorkerRequestPayload,
): Promise<T> {
  const sequence = ++nextRequestSequence
  return new Promise<T>((resolve, reject) => {
    // A worker that never answers must not hang the caller forever — the timer is the backstop
    // `readWorker`'s own `onerror` cannot cover, because a stuck worker throws nothing at all.
    const timer = setTimeout(() => {
      if (pending.delete(sequence)) reject(new Error('The capture read worker did not answer in time.'))
    }, WORKER_READ_TIMEOUT_MS)
    pending.set(sequence, { resolve, reject, timer })
    const { message, transfer } = build(sequence)
    active.postMessage(message, transfer)
  })
}

type WorkerRequestPayload = { message: unknown; transfer: Transferable[] }

/**
 * `readTextBox`, off the main thread when a worker is available. `frame` stays on the main thread
 * either way — `screenPng`/`encodeBox` still encode it here if the box settles — and only a
 * bitmap **derived** from it, via `createImageBitmap(frame)`, is transferred, so the worker never
 * needs the canonical pixels handed back.
 */
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
    // This request failed, or the worker died outright — either way this tick reads the frame it
    // already has rather than losing the box. A dead worker also resets `lastSentGlyphs`: the
    // next worker, if `readWorker` ever builds one again, has no alphabet of its own yet.
    if (workerUnavailable) lastSentGlyphs = null
    return readTextBox(frame, profile, glyphs, origin)
  }
}

/**
 * The console screen as a PNG file, off the main thread when a worker is available — the encode
 * `screenPng` did inline before #118. Falls back to `screenPng` itself on any failure, exactly as
 * `readBox` falls back to `readTextBox`.
 */
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
    // The name is a label only, exactly as `screenPng` documents — `importDialogueMedia` derives
    // the real one in `media/` from the capture and media ids.
    return new File([blob], 'capture.png', { type: 'image/png' })
  } catch {
    return screenPng(frame, profile, origin)
  }
}

/** One picture the watcher wrote, kept only long enough to judge the box that follows it. */
type WrittenFrame = { media: DialogueMedia; text: string }

/**
 * The last two boxes written for each capture, oldest first — the window `middleAddsNothing`
 * judges a middle in.
 *
 * Module-level and never in the store, for the reason the file's opening comment gives for `settle`
 * and `heldFrames`: it is transient, unserialisable, and no part of the document. Keyed by capture
 * rather than a single shared array (#118): the write queue now lets two different captures write
 * concurrently, and a shared window would have no way to tell whether an entry sitting in it
 * belongs to the capture about to judge a middle or to another one's write racing alongside it.
 */
const writtenByCapture = new Map<PendingCaptureId, WrittenFrame[]>()

/** Passed to `useSyncExternalStore` by reference — a fresh object per call renders forever. */
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

/**
 * Whether the loop is running, on its own subscription — mirroring `useSaveState` over the
 * document store, and for the same reason. A watcher reading ten times a second changes its
 * counters constantly, and the panel around the toggle has no business re-rendering for that; a
 * boolean is a stable return per the `useSyncExternalStore` contract in CLAUDE.md, so only the
 * status line beside the button subscribes to the whole state.
 */
export function useWatching(): boolean {
  return useSyncExternalStore(subscribe, isWatching)
}

function isWatching(): boolean {
  return state.kind === 'watching'
}

/**
 * The held queue, on its own subscription — it outlives the watcher being switched off, which is
 * the whole point: the alphabet is usually answered once the conversation is over.
 */
export function useHeldFrames(): HeldState {
  return useSyncExternalStore(subscribe, getHeld)
}

function getHeld(): HeldState {
  return held
}

/**
 * Starts reading the text box — the only two ways in are this and the button that calls it, per
 * #107. No user activation is required and none is asked for: the activation was the click on
 * Connect, and every frame since then has been a `drawImage`.
 *
 * `'new'` always begins an empty capture, built the first time a box settles. `'extend'` reopens
 * `pendingCaptures.at(-1)` from the start — the same conversation picked back up rather than
 * re-created, so its `spokenAt`, `npcName`, `relevance` and media order are all untouched — and
 * with an empty queue there is nothing to reopen, so it behaves exactly like `'new'`.
 *
 * Already recording is a no-op rather than a restart: the two triggers are read as Stop while a
 * recording runs, so nothing calls this while `state.kind === 'watching'` in the first place — see
 * `CaptureRecorder`.
 */
export function startRecording(mode: 'new' | 'extend'): void {
  if (state.kind === 'watching') return
  session += 1
  settle = NOTHING_SEEN
  settledFor = { profileId: null }
  currentCaptureId = null
  writtenByCapture.clear()
  failures = 0
  // The held queue is deliberately not cleared: it survives the watcher being switched off and on,
  // because the alphabet is usually answered once the conversation is over.
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

/**
 * Stops recording, however it was started. Unconditional: the connection can end while the loop
 * runs, and a recording that could refuse to stop would have no way back — see `CaptureRecorder`.
 * A recording that is never stopped is simply one long capture, never a lost one.
 *
 * `writeQueues` is deliberately left alone (#118): a box settled just before Stop can still be
 * mid-encode or mid-write, and nothing here cancels its chain — it drains on its own, so a
 * recording stopped mid-write still ends with every picture on disk rather than one the document
 * names and `media/` does not have.
 */
export function stopRecording(): void {
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

/**
 * Starts or stops a recording exactly as `CaptureRecorder`'s own two buttons decide to: stop is
 * unconditional, start only runs when nothing currently blocks a capture. The one rule both the
 * buttons and a bound gamepad button (#111) trigger through, so a controller press can never
 * disagree with the button beside it about when a recording may begin.
 */
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

/**
 * The next tick, scheduled only after the previous one has finished rather than on an interval:
 * a tick that writes a picture into `media/` can take longer than `POLL_MS`, and overlapping ticks
 * would read the same box twice and race each other's append.
 */
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
    // Nothing in `tick` is expected to throw that it does not handle itself, so this is the
    // backstop: without it a bad frame would become an unhandled rejection every 100 ms, invisible
    // outside the console, while the loop kept going as if it were reading.
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
    // The capture button's own sentence, verbatim: two sets of words for one condition would
    // drift, and this one already names the fix.
    pause(blocker ?? 'Calibrate a capture profile below.')
    return
  }

  // A replay writes the held queue frame by frame, each one an await long. Reading on underneath
  // it would interleave two writers into one capture, and put boxes into it out of order.
  if (replaying) {
    pause('Writing the boxes that were waiting for the alphabet.')
    return
  }

  // Both halves are load-bearing. A text field anywhere in the app can stay `document.activeElement`
  // for as long as you play in the emulator afterwards, so without `document.hasFocus()` the loop
  // would pause for the rest of the session the moment a field was last clicked into.
  if (document.hasFocus() && isTextFieldFocused()) {
    pause('Holding while you type. Click back into the game and it carries on.')
    return
  }

  // What the box last settled against is only meaningful under the profile it was read with: a
  // profile switched mid-conversation can read the same pixels differently, but the capture being
  // written into is unaffected — it is whatever `startRecording` opened, not something the profile
  // chooses.
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
    // The stop or start that bumped the session owns the state now: a grab can wait seconds for a
    // frame that never comes, and a deliberate Stop must not be overwritten by its rejection.
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
  // The stop, start or profile switch that bumped the session owns the state now: a worker round
  // trip is an await like any other, and a reply arriving after that must not be acted on.
  if (mine !== session) return
  const step = nextSettle(settle, boxReadingFrom(reading), SETTLE_TICKS)
  settle = step.state
  markRead()

  const settled = step.settled
  if (settled === null) return

  // A box the alphabet cannot yet name — or a readable one arriving behind one that is still
  // waiting — belongs to the capture in progress and waits with it: a held frame can only ever be
  // appended at the *end* of a capture, so writing the boxes that came after it would put the
  // conversation down out of order, and `appendWithoutOverlap` would then join the held one to the
  // wrong suffix or swallow it whole. A capture not yet open has nowhere for the frame to wait —
  // the box is simply not captured; if it is still on screen once the alphabet can read it whole,
  // it reads as a change from this held signature and settles again.
  if (currentCaptureId !== null && (settled.kind === 'held' || holdsFrameFor(currentCaptureId))) {
    hold(currentCaptureId, frame, origin)
    return
  }
  if (settled.kind === 'held') return

  writeIntoQueue(profile, frame, origin, settled.text)
}

/**
 * One settled box into the pending-capture queue: the first box of a conversation creates the
 * capture, every later one appends to it — ensuring `currentCaptureId` names a live one and then
 * queuing `writeIntoCapture` against it, since neither `store.ts` nor `capture-to-dialogue.ts` know
 * about a `PendingCapture`.
 *
 * Synchronous, and deliberately not awaited by the tick (#118): resolving *which* capture this box
 * belongs to has to happen now, before the next tick reads `currentCaptureId` — but the encode and
 * the disk write do not, and queuing them is what lets `schedule` arm the next poll immediately
 * instead of paying for those out of the reading budget.
 *
 * `currentCaptureId` names which capture that is; `null` means this settled box is the first of a
 * new conversation.
 */
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

/**
 * One capture's queue of writes still in flight or waiting, run in order — the FIFO #118 needs:
 * `appendWithoutOverlap` joins a scrolled box to the suffix before it, and boxes written out of
 * order would join it to the wrong one. Two different captures each get their own chain and run
 * concurrently; nothing here ever waits on another capture's.
 */
const writeQueues = new Map<PendingCaptureId, Promise<void>>()

/**
 * Queues one settled box's write onto `captureId`'s own chain and returns immediately. Errors
 * surface through `pause`, exactly as they did when the tick awaited this inline — and a failure
 * here does not break the chain for the boxes queued after it, so one bad write cannot wedge the
 * rest of the conversation.
 */
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
          countAppended(transcript)
          break
        case 'unchanged':
          countRepeated()
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

/** The next settled box with no capture in progress always starts a fresh conversation. */
function openCapture(): void {
  const app = getState()
  const pendingCaptures = app.kind === 'ready' ? app.project.pendingCaptures : []
  const capture: PendingCapture = {
    id: newPendingCaptureId(),
    // Only a handle — #70 identifies a capture by its first line and its picture, not its name.
    npcName: nextCaptureName(pendingCaptures),
    text: '',
    media: [],
    spokenAt: new Date().toISOString(),
    relevance: [],
  }
  dispatch({ kind: 'pending-capture/added', capture })
  setCurrentCaptureId(capture.id)
  countConversation()
}

/** The pending capture as the document holds it now, or null once it is gone — mirrors
 * `currentDialogue`; not added to `store.ts` itself, since nothing outside this file needs it. */
function currentPendingCapture(id: PendingCaptureId): PendingCapture | null {
  const app = getState()
  if (app.kind !== 'ready') return null
  return app.project.pendingCaptures.find((capture) => capture.id === id) ?? null
}

/** `NPC 1`, `NPC 2`, … — the smallest number not already a pending capture's name. */
function nextCaptureName(existing: readonly PendingCapture[]): string {
  const used = new Set(existing.map((capture) => capture.npcName))
  let n = 1
  while (used.has(`NPC ${n}`)) n += 1
  return `NPC ${n}`
}

/**
 * One settled box into one **specific** capture: the picture and what the box said that it does
 * not. Never opens or bootstraps one — `captureId` already names a capture, live or held, and the
 * caller decides what "gone" means for it.
 *
 * The document as it stands **now**, never a copy taken before an await: a settled box is written
 * several hundred milliseconds after the tick that read it began, and a replayed one minutes
 * after. `unchanged` writes nothing at all — no picture and no dispatch — because a box that says
 * nothing new is the ordinary case for a loop reading ten times a second, and a picture of it
 * would bury the conversation. Only the watcher applies that rule; a deliberate press still keeps
 * its frame.
 *
 * A box that *is* written can still be taken back once the box after it arrives — see `keepWindow`.
 * That too is the watcher's alone, and for the same reason: it fires unattended, so it is the one
 * caller that can judge a frame against what came after it rather than against a press.
 *
 * Two callers: `queueWrite`, once `writeIntoQueue` has ensured `currentCaptureId` names a live
 * capture, and `replayInto`, which always names the capture a held frame belongs to and never
 * creates one — a capture that already left the queue is `'gone'`, not a fresh conversation
 * started in its place.
 */
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

  // The document as it stands now, mirroring `captureIntoDialogue`'s own note: encoding and
  // writing the picture takes long enough for the capture to have been placed or deleted
  // underneath this write.
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

/**
 * Slides the window on by one box, taking back the picture it pushes out of the middle.
 *
 * Here rather than in the tick, so a replayed frame is judged exactly as a live one is: both write
 * through `writeIntoCapture`, and a held box replayed in capture order sits in the same run of a
 * scrolling text box as the rest.
 *
 * The box that just landed is the *third* of the three, so the judgement is always about the one
 * before it — which is why nothing is ever taken back until a box after it exists. `before` is
 * empty for the first pair, and `middleAddsNothing` reads that as the question a filling box asks
 * rather than a scrolling one. After a removal `before` stays the anchor, so a whole run of
 * in-between boxes falls away one at a time as the run goes on.
 */
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
    // Written before the await, so a write landing underneath this one cannot judge the same middle
    // a second time and try to remove it twice.
    writtenByCapture.set(captureId, [...previous.slice(0, -1), entry])
    await takeBack(captureId, middle.media)
    return
  }
  writtenByCapture.set(captureId, [...previous, entry].slice(-2))
}

/**
 * Takes one picture back out: the document first, the file after.
 *
 * The order and the reason are the panel's own remove — after the dispatch nothing in the document
 * names the file, so it would sit in `media/` forever, invisible from inside the app. The
 * conversation's text is deliberately left as it stands: it was already joined from every box, and
 * this frame's words are all still in it, carried by the two frames around it.
 *
 * A picture the user removed by hand in the meantime is left alone, rather than relying on the
 * reducer's no-op and deleting a file the document may since have handed to something else. The
 * same holds for a capture placed or deleted in the meantime — `currentPendingCapture` returning
 * `null` is that check.
 */
async function takeBack(captureId: PendingCaptureId, media: DialogueMedia): Promise<void> {
  const target = currentPendingCapture(captureId)
  if (target === null || !target.media.some((candidate) => candidate.id === media.id)) return
  dispatch({ kind: 'pending-capture/media-removed', captureId, mediaId: media.id })
  await discardMediaFile(media.file.fileName)
  countDropped()
}

/**
 * Notes that a frame was read — at whole-second resolution, deliberately.
 *
 * The panel shows this as "read a moment ago", so a millisecond nobody can see is not worth a
 * notify: at `POLL_MS` the exact stamp would publish a new state ten times a second and re-render
 * everything subscribed to it, for a line that changes once a second at most.
 */
function markRead(): void {
  if (state.kind !== 'watching') return
  const at = Date.now()
  const same = state.lastReadAt !== null && Math.floor(at / 1000) === Math.floor(state.lastReadAt / 1000)
  if (same && state.paused === null) return
  setState({ ...state, paused: null, lastReadAt: at })
}

function countRepeated(): void {
  if (state.kind !== 'watching') return
  setState({ ...state, repeated: state.repeated + 1 })
}

function countDropped(): void {
  if (state.kind !== 'watching') return
  setState({ ...state, dropped: state.dropped + 1 })
}

function countAppended(text: string): void {
  if (state.kind !== 'watching') return
  setState({ ...state, appended: state.appended + 1, lastText: text })
}

function countConversation(): void {
  if (state.kind !== 'watching') return
  setState({ ...state, conversations: state.conversations + 1 })
}

/**
 * Keeps a box the alphabet could not name, so the first play session — exactly the session where
 * the alphabet is still open — does not silently lose the most lines.
 */
function hold(captureId: PendingCaptureId, frame: ImageData, origin: Point): void {
  heldFrames.push({ captureId, frame, origin })
  let dropped = held.dropped
  // The oldest goes: the queue is replayed in capture order, and the newest frames are the ones
  // whose conversation the player can still remember.
  while (heldFrames.length > HELD_LIMIT) {
    heldFrames.shift()
    dropped += 1
  }
  setHeld({ waiting: heldFrames.length, dropped })
}

/** Whether a box of this capture is already waiting, and the next one must therefore wait behind it. */
function holdsFrameFor(captureId: PendingCaptureId): boolean {
  return heldFrames.some((entry) => entry.captureId === captureId)
}

/**
 * Every tile the queue's frames cannot name, deduplicated by bitmap — one round of questions for
 * the whole queue, not one per frame.
 *
 * The same deduplication `readTextBox` already does within one frame, extended across all of them:
 * three held boxes of the same conversation ask about one `e`, not three.
 */
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

/**
 * Re-reads every held frame with the grown alphabet and writes what it can.
 *
 * In **capture order**, so `appendWithoutOverlap` sees the boxes in the order the game drew them —
 * out of order it would join a scrolled box to the wrong suffix. Nothing is discarded except a
 * frame whose line is gone: one the alphabet still cannot read, and one whose write failed, both
 * stay in the queue for the next round.
 */
export async function replayHeldFrames(
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
): Promise<HeldReplay> {
  // A snapshot to walk, while `heldFrames` stays the truth: an entry leaves the queue only once it
  // has been written or dropped, so a throw anywhere in here loses nothing. Frames the watcher
  // holds *while* this runs are not in the snapshot, and stay behind the ones being replayed —
  // which is still capture order.
  const pending = [...heldFrames]
  const replay = {
    appended: 0,
    gone: 0,
    stillHeld: 0,
    repeated: 0,
    dropped: held.dropped,
    failures: [] as string[],
  }
  // The count is what the panel showed; the frames themselves went long ago. Cleared here because
  // this round is the acknowledgement.
  setHeld({ waiting: heldFrames.length, dropped: 0 })
  // The tick stands down for the duration: two writers appending to one capture would interleave
  // the boxes, and each one's append is computed while the other's is still in flight.
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
  // Captures with a frame left behind in this round. Everything after it waits, for the reason the
  // tick holds a readable box behind a held one: appending it now would put the conversation out
  // of order.
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
        countAppended(reading.text)
      } else if (written === 'gone') {
        replay.gone += 1
      } else {
        // The capture already says what this box says. It is *not* counted as written: a held box
        // replayed after the boxes that followed it can only be appended at the end of the
        // conversation, and `appendWithoutOverlap` swallowing it there is exactly the case the
        // reader has to be told about rather than left to notice.
        replay.repeated += 1
      }
    } catch (error) {
      // Kept, not dropped: the frame is still the only record of that box — and the boxes behind
      // it in the same capture are kept with it, so a retry writes them in order.
      blocked.add(entry.captureId)
      replay.failures.push(describeError(error))
    }
  }
}

/**
 * Throws the whole queue away, and says how many boxes went with it.
 *
 * The frames are the only record of those boxes, and a replay is the only other way out — one that
 * needs an alphabet able to name them. So this is the single place the watcher loses data on
 * purpose, which is why the panel confirms before calling it. `dropped` is cleared with them for
 * the reason `replayHeldFrames` clears it: this round *is* the acknowledgement.
 *
 * Safe against a replay in flight only because the control is disabled while one runs — `release`
 * filters an already-empty array and would quietly write frames the user just discarded.
 */
export function discardHeldFrames(): number {
  const waiting = heldFrames.length
  heldFrames = []
  setHeld(NOTHING_HELD)
  return waiting
}

/** Takes one entry out of the queue. Absent already — pushed out by the cap mid-replay — is fine. */
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
    // Named, because a held box can only be appended at the *end* of the capture, after the boxes
    // that were written while it waited — and one that says what the capture already says is
    // swallowed there rather than slotted back into its place.
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

/** Reports why this tick read nothing, and grabs no frame at all. Repeating a reason is silent. */
function pause(reason: string): void {
  if (state.kind !== 'watching' || state.paused === reason) return
  setState({ ...state, paused: reason })
}

function setState(next: WatchState): void {
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

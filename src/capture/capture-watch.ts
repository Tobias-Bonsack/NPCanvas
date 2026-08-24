import { useSyncExternalStore } from 'react'
import { currentDialogue, getState } from '../project/store.ts'
import type { CaptureProfile, DialogueId } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { activeCaptureProfile } from './active-profile.ts'
import type { SettleState } from './box-settle.ts'
import { NOTHING_SEEN, boxReadingFrom, nextSettle } from './box-settle.ts'
import { getCaptureSource, grabFrame } from './capture-session.ts'
import { appendOutcome, captureBlocker, captureIntoDialogue } from './capture-to-dialogue.ts'
import type { UnknownTile } from './glyph-matcher.ts'
import { readTextBox } from './glyph-matcher.ts'

// Logging a line without leaving the game.
//
// The capture connection is live for the whole session — `getDisplayMedia` ran once, and every
// frame afterwards is a `drawImage` with no prompt — so the pixels are available continuously,
// including while the emulator holds the OS focus and the page sees no key events at all. What was
// missing was only something to decide *when* a frame is worth reading, which `box-settle.ts`
// answers and this loop asks four times a second.
//
// Module-level rather than component state, for the same reason `capture-session.ts` and
// `active-profile.ts` are: the loop has to outlive `DialoguePanel` unmounting, which switching to
// the quest board does. Module-level rather than store state, for the same reason again: it is
// neither serialisable nor part of the document.
//
// The watcher writes **only** into the selected dialogue. `mapId`, `position` and `npcName` are
// knowledge only the player has, and inventing them badly is worse than asking — so this turns one
// focus change per *line* into one pin and one name per *conversation*, and no more.

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
      /** Boxes written into a line since the watcher was switched on. */
      appended: number
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
 * frame again — and `captureIntoDialogue` takes a frame, so a held one replays through the
 * ordinary path with nothing special about it.
 *
 * The `dialogueId` is carried because the alphabet may be completed long after the player has
 * moved on: a held frame belongs to the line that was selected when it was read, never to
 * whatever happens to be selected when it is replayed.
 */
export type HeldFrame = { dialogueId: DialogueId; frame: ImageData }

/** The queue, as the panel shows it. Its own snapshot, because it outlives the watcher being off. */
export type HeldState = {
  waiting: number
  /** Frames the cap pushed out. Surfaced rather than silently discarded; cleared by a replay. */
  dropped: number
}

/** What one round of answering the learner did. */
export type HeldReplay = {
  appended: number
  /** Frames whose line no longer exists. Dropped with their entry rather than written elsewhere. */
  gone: number
  /** Frames the grown alphabet still cannot read whole. They stay in the queue. */
  stillHeld: number
  /** Frames the cap had already pushed out before this round. */
  dropped: number
  /** What went wrong writing a frame, if anything. Those frames stay in the queue too. */
  failures: readonly string[]
}

/**
 * How many frames the queue holds.
 *
 * `ImageData` is the whole captured frame: a windowed emulator at roughly 720 × 480 is about
 * 1.4 MB, and a full-screen 4K source twenty times that. Dropping the oldest with a visible note
 * is honest; filling memory silently is not.
 */
const HELD_LIMIT = 24

/** How often the box is read. Fast enough that a line is never on screen without being seen. */
const POLL_MS = 200

/**
 * How many identical readings make a box settled — see `box-settle.ts`.
 *
 * Three at 200 ms is roughly six tenths of a second of stillness: longer than the gap between two
 * characters of the typing animation, and shorter than anyone reads a line in.
 */
const SETTLE_TICKS = 3

/**
 * Frame grabs in a row that end the session. A captured window minimised to the tray stops
 * producing frames for good, while a single hiccup is not worth ending a conversation over.
 */
const FAILURES_BEFORE_STOP = 3

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
let failures = 0

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
 * document store, and for the same reason. A watcher reading four times a second changes its
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
 * Starts reading the text box.
 *
 * No user activation is required and none is asked for: the activation was the click on Connect,
 * and every frame since then has been a `drawImage`.
 */
export function startWatching(): void {
  if (state.kind === 'watching') return
  session += 1
  settle = NOTHING_SEEN
  failures = 0
  // The held queue is deliberately not cleared: it survives the watcher being switched off and on,
  // because the alphabet is usually answered once the conversation is over.
  setState({ kind: 'watching', appended: 0, lastText: null, paused: null, lastReadAt: null })
  schedule(session)
}

export function stopWatching(): void {
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
  if (app.selection.kind !== 'dialogue') {
    pause('Select a pin — every box read is appended to the selected line.')
    return
  }
  const dialogueId = app.selection.id
  if (currentDialogue(dialogueId) === null) {
    pause('The selected line is gone. Place or select a pin to keep logging.')
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

  // Both halves are load-bearing. `useFieldDraft` yields to the document whenever it changes
  // underneath, so an append landing in an unflushed draft would discard what was just typed —
  // and the line's textarea stays `document.activeElement` for as long as you play in the
  // emulator, so without `document.hasFocus()` the loop would pause for the rest of the session.
  if (document.hasFocus() && isTextFieldFocused()) {
    pause('Holding while you type. Click back into the game and it carries on.')
    return
  }

  let frame: ImageData
  try {
    frame = await grabFrame()
  } catch (error) {
    failures += 1
    if (failures >= FAILURES_BEFORE_STOP) stopWith(describeError(error))
    else pause(describeError(error))
    return
  }
  if (mine !== session) return
  failures = 0

  const step = nextSettle(settle, boxReadingFrom(readTextBox(frame, profile)), SETTLE_TICKS)
  settle = step.state
  markRead()

  const settled = step.settled
  if (settled === null || settled.kind === 'empty') return
  if (settled.kind === 'held') {
    hold(dialogueId, frame)
    return
  }

  try {
    if ((await writeBox(dialogueId, profile, frame, settled.text)) === 'appended') {
      countAppended(settled.text)
    }
  } catch (error) {
    // The box has already been marked emitted, so this is not retried against the same frame —
    // the next box the player advances to is read normally.
    pause(describeError(error))
  }
}

/**
 * One settled box into one line: the picture and what the box said that the line does not.
 *
 * The document as it stands **now**, never a copy taken before an await: a settled box is written
 * several hundred milliseconds after the tick that read it began, and a replayed one minutes
 * after. `unchanged` writes nothing at all — no picture and no dispatch — because a box that says
 * nothing new is the ordinary case for a loop reading four times a second, and a picture of it
 * would bury the conversation. Only the watcher applies that rule; a deliberate press still keeps
 * its frame.
 */
async function writeBox(
  dialogueId: DialogueId,
  profile: CaptureProfile,
  frame: ImageData,
  text: string,
): Promise<'appended' | 'unchanged' | 'gone'> {
  const target = currentDialogue(dialogueId)
  if (target === null) return 'gone'
  if (appendOutcome(target.text, text).text !== 'appended') return 'unchanged'
  await captureIntoDialogue(target, profile, frame, text)
  return 'appended'
}

/**
 * Notes that a frame was read — at whole-second resolution, deliberately.
 *
 * The panel shows this as "read a moment ago", so a millisecond nobody can see is not worth a
 * notify: at `POLL_MS` the exact stamp would publish a new state five times a second and re-render
 * everything subscribed to it, for a line that changes once a second at most.
 */
function markRead(): void {
  if (state.kind !== 'watching') return
  const at = Date.now()
  const same = state.lastReadAt !== null && Math.floor(at / 1000) === Math.floor(state.lastReadAt / 1000)
  if (same && state.paused === null) return
  setState({ ...state, paused: null, lastReadAt: at })
}

function countAppended(text: string): void {
  if (state.kind !== 'watching') return
  setState({ ...state, appended: state.appended + 1, lastText: text })
}

/**
 * Keeps a box the alphabet could not name, so the first play session — exactly the session where
 * the alphabet is still open — does not silently lose the most lines.
 */
function hold(dialogueId: DialogueId, frame: ImageData): void {
  heldFrames.push({ dialogueId, frame })
  let dropped = held.dropped
  // The oldest goes: the queue is replayed in capture order, and the newest frames are the ones
  // whose conversation the player can still remember.
  while (heldFrames.length > HELD_LIMIT) {
    heldFrames.shift()
    dropped += 1
  }
  setHeld({ waiting: heldFrames.length, dropped })
}

/**
 * Every tile the queue's frames cannot name, deduplicated by bitmap — one round of questions for
 * the whole queue, not one per frame.
 *
 * The same deduplication `readTextBox` already does within one frame, extended across all of them:
 * three held boxes of the same conversation ask about one `e`, not three.
 */
export function heldUnknownTiles(profile: CaptureProfile): UnknownTile[] {
  const tiles: UnknownTile[] = []
  const seen = new Set<string>()
  for (const entry of heldFrames) {
    for (const tile of readTextBox(entry.frame, profile).unknown) {
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
export async function replayHeldFrames(profile: CaptureProfile): Promise<HeldReplay> {
  // A snapshot to walk, while `heldFrames` stays the truth: an entry leaves the queue only once it
  // has been written or dropped, so a throw anywhere in here loses nothing. Frames the watcher
  // holds *while* this runs are not in the snapshot, and stay behind the ones being replayed —
  // which is still capture order.
  const pending = [...heldFrames]
  const replay = {
    appended: 0,
    gone: 0,
    stillHeld: 0,
    dropped: held.dropped,
    failures: [] as string[],
  }
  // The count is what the panel showed; the frames themselves went long ago. Cleared here because
  // this round is the acknowledgement.
  setHeld({ waiting: heldFrames.length, dropped: 0 })

  for (const entry of pending) {
    if (currentDialogue(entry.dialogueId) === null) {
      release(entry)
      replay.gone += 1
      continue
    }
    const reading = readTextBox(entry.frame, profile)
    if (reading.unknown.length > 0) {
      replay.stillHeld += 1
      continue
    }
    try {
      const written = await writeBox(entry.dialogueId, profile, entry.frame, reading.text)
      release(entry)
      if (written === 'appended') {
        replay.appended += 1
        countAppended(reading.text)
      } else if (written === 'gone') {
        replay.gone += 1
      }
    } catch (error) {
      // Kept, not dropped: the frame is still the only record of that box.
      replay.failures.push(describeError(error))
    }
  }

  return replay
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
    parts.push(`${replay.gone} belonged to a line that no longer exists and were dropped`)
  }
  if (replay.stillHeld > 0) {
    parts.push(`${replay.stillHeld} still hold tiles the alphabet cannot name, and are kept`)
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

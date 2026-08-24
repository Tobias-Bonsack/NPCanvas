import { useSyncExternalStore } from 'react'
import { currentDialogue, getState } from '../project/store.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { activeCaptureProfile } from './active-profile.ts'
import type { SettleState } from './box-settle.ts'
import { NOTHING_SEEN, boxReadingFrom, nextSettle } from './box-settle.ts'
import { getCaptureSource, grabFrame } from './capture-session.ts'
import { appendOutcome, captureBlocker, captureIntoDialogue } from './capture-to-dialogue.ts'
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
      /** Boxes read but not transcribable — the alphabet is still short. #67 recovers them. */
      held: number
      /** The last line written, so the panel can be checked out of the corner of the eye. */
      lastText: string | null
      /** Why this tick read nothing, in a sentence naming the fix. `null` while it is reading. */
      paused: string | null
      /** `Date.now()` of the last frame that was read, or `null` before the first. */
      lastReadAt: number | null
    }

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

let state: WatchState = OFF
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
  setState({
    kind: 'watching',
    appended: 0,
    held: 0,
    lastText: null,
    paused: null,
    lastReadAt: null,
  })
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
    countHeld()
    return
  }

  // The document as it stands now, never the copy this tick opened with: a settled box is read
  // several hundred milliseconds after the tick began, and the line may have been edited by hand
  // in between.
  const target = currentDialogue(dialogueId)
  if (target === null) return
  // Asked before anything is written: a box that says nothing new is the ordinary case for a loop
  // reading four times a second, and a picture of it would bury the conversation.
  if (appendOutcome(target.text, settled.text).text !== 'appended') return

  try {
    await captureIntoDialogue(target, profile, frame, settled.text)
  } catch (error) {
    // The box has already been marked emitted, so this is not retried against the same frame —
    // the next box the player advances to is read normally.
    pause(describeError(error))
    return
  }
  if (mine !== session) return
  countAppended(settled.text)
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

function countHeld(): void {
  if (state.kind !== 'watching') return
  setState({ ...state, held: state.held + 1 })
}

function countAppended(text: string): void {
  if (state.kind !== 'watching') return
  setState({ ...state, appended: state.appended + 1, lastText: text })
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

import { useSyncExternalStore } from 'react'
import { currentDialogue, getState } from '../project/store.ts'
import type { CaptureProfile, CaptureProfileId, DialogueId, Glyph } from '../project/types.ts'
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
      /**
       * Boxes that came to rest saying only what the line already says, and were therefore not
       * written. Usually a box read again after the game paused on it; occasionally a sentence an
       * NPC genuinely repeats, which `appendWithoutOverlap` cannot tell apart from the first one.
       */
      repeated: number
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
  /** Frames whose box says only what the line already says — see `replayInto`. */
  repeated: number
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
/** What `settle` describes. A box is only "already written" for the line it was written into. */
let settledFor: { dialogueId: DialogueId | null; profileId: CaptureProfileId | null } = {
  dialogueId: null,
  profileId: null,
}
let failures = 0
/** Whether `replayHeldFrames` is writing. The tick stands down rather than interleaving with it. */
let replaying = false

/**
 * Pushes the panel's line draft into the document, if a panel is mounted — see `setDraftFlush`.
 * The watcher appends to what the document says, and the field is 300 ms ahead of it.
 */
let flushDraft: (() => void) | null = null

/**
 * Registers the mounted panel's draft flush, so an unattended append cannot discard what is being
 * typed. `null` on unmount: a stale closure would commit into a dialogue that is no longer shown.
 */
export function setDraftFlush(flush: (() => void) | null): void {
  flushDraft = flush
}

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
  setState({
    kind: 'watching',
    appended: 0,
    repeated: 0,
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
  } catch (error) {
    // Nothing in `tick` is expected to throw that it does not handle itself, so this is the
    // backstop: without it a bad frame would become an unhandled rejection every 200 ms, invisible
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

  // A replay writes the held queue frame by frame, each one an await long. Reading on underneath
  // it would interleave two writers into one line, and put boxes into it out of order.
  if (replaying) {
    pause('Writing the boxes that were waiting for the alphabet.')
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

  // What the box last settled *against* is only meaningful for one line read under one profile:
  // select another pin without advancing the game and the box on screen has not changed, but it
  // has never been written to this line. Same for a profile switched mid-conversation, which can
  // read the same pixels differently.
  if (dialogueId !== settledFor.dialogueId || profile.id !== settledFor.profileId) {
    settle = NOTHING_SEEN
    settledFor = { dialogueId, profileId: profile.id }
  }

  let frame: ImageData
  try {
    frame = await grabFrame()
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
  const step = nextSettle(settle, boxReadingFrom(readTextBox(frame, profile, glyphs)), SETTLE_TICKS)
  settle = step.state
  markRead()

  const settled = step.settled
  if (settled === null) return
  // A readable box goes into the queue too, once a box before it is waiting there: a held frame can
  // only ever be appended at the *end* of the line, so writing the boxes that came after it would
  // put the conversation down out of order — and `appendWithoutOverlap` would then join the held
  // one to the wrong suffix, or swallow it whole. Deferred work is the point of the queue; a
  // scrambled line is not.
  if (settled.kind === 'held' || holdsFrameFor(dialogueId)) {
    hold(dialogueId, frame)
    return
  }

  // The line as the field has it, before reading what the document says: `useFieldDraft` only
  // commits 300 ms after the last keystroke, and typing a word and clicking straight back into the
  // emulator would otherwise let this append land first — after which the draft yields to the
  // document and the typed characters are gone. The manual button flushes for the same reason.
  flushDraft?.()

  try {
    switch (await writeBox(dialogueId, profile, frame, settled.text)) {
      case 'appended':
        countAppended(settled.text)
        break
      case 'unchanged':
        // The box said what the line already says. `box-settle.ts` treats a sentence repeated
        // after a gap as a second box deliberately, and `appendWithoutOverlap` cannot: counted
        // rather than passed over, so a line that logged one "OK." out of two says so.
        countRepeated()
        break
      case 'gone':
        break
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
  // Asked twice, because the answer can change in between: `captureIntoDialogue` encodes a PNG and
  // writes it before it appends, and a manual capture running alongside can land its own append in
  // that window. Its verdict is the one that describes what the document actually took.
  const result = await captureIntoDialogue(target, profile, frame, text)
  return result.text === 'appended' ? 'appended' : 'unchanged'
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

function countRepeated(): void {
  if (state.kind !== 'watching') return
  setState({ ...state, repeated: state.repeated + 1 })
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

/** Whether a box of this line is already waiting, and the next one must therefore wait behind it. */
function holdsFrameFor(dialogueId: DialogueId): boolean {
  return heldFrames.some((entry) => entry.dialogueId === dialogueId)
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
    for (const tile of readTextBox(entry.frame, profile, glyphs).unknown) {
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
  // The tick stands down for the duration: two writers appending to one line would interleave the
  // boxes, and each one's append is computed while the other's is still in flight.
  replaying = true
  // The panel's line field is 300 ms ahead of the document, exactly as it is for a live tick.
  flushDraft?.()

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
  // Lines with a frame left behind in this round. Everything after it waits, for the reason the
  // tick holds a readable box behind a held one: appending it now would put the line out of order.
  const blocked = new Set<DialogueId>()

  for (const entry of pending) {
    if (currentDialogue(entry.dialogueId) === null) {
      release(entry)
      replay.gone += 1
      continue
    }
    const reading = readTextBox(entry.frame, profile, glyphs)
    if (reading.unknown.length > 0 || blocked.has(entry.dialogueId)) {
      blocked.add(entry.dialogueId)
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
      } else {
        // The line already says what this box says. It is *not* counted as written: a held box
        // replayed after the boxes that followed it can only be appended at the end of the line,
        // and `appendWithoutOverlap` swallowing it there is exactly the case the reader has to be
        // told about rather than left to notice.
        replay.repeated += 1
      }
    } catch (error) {
      // Kept, not dropped: the frame is still the only record of that box — and the boxes behind
      // it in the same line are kept with it, so a retry writes them in order.
      blocked.add(entry.dialogueId)
      replay.failures.push(describeError(error))
    }
  }
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
  if (replay.repeated > 0) {
    // Named, because a held box can only be appended at the *end* of the line, after the boxes
    // that were written while it waited — and one that says what the line already says is swallowed
    // there rather than slotted back into its place.
    parts.push(
      `${replay.repeated} said only what the line already said, and were not written — a held box ` +
        'is appended at the end of the line, not back in its place',
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

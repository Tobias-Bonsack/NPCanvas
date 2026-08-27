import { useSyncExternalStore } from 'react'
import { discardMediaFile } from '../media/discard-media.ts'
import { importDialogueMedia } from '../media/import-media.ts'
import { newPendingCaptureId } from '../project/ids.ts'
import { currentDialogue, dispatch, getState } from '../project/store.ts'
import type {
  CaptureProfile,
  CaptureProfileId,
  DialogueId,
  DialogueMedia,
  Glyph,
  MediaId,
  PendingCapture,
  PendingCaptureId,
} from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { activeCaptureProfile } from './active-profile.ts'
import { appendWithoutOverlap } from './append-overlap.ts'
import { battleGaugeVisible } from './battle-gauge.ts'
import type { BattlePhase } from './battle-run.ts'
import { nextBattlePhase } from './battle-run.ts'
import type { SettleState } from './box-settle.ts'
import { NOTHING_SEEN, boxReadingFrom, nextSettle } from './box-settle.ts'
import { getCaptureSource, grabFrame } from './capture-session.ts'
import {
  appendOutcome,
  captureBlocker,
  captureIntoDialogue,
  screenPng,
} from './capture-to-dialogue.ts'
import type { UnknownTile } from './glyph-matcher.ts'
import { readTextBox, sampleNative } from './glyph-matcher.ts'
import { middleAddsNothing } from './middle-frame.ts'

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
//
// **A fight is a stretch of one conversation, and only its tail survives.** A battle box reads as
// well as anything an NPC says, so what separates them is not in the text box at all — it is the
// opponent's status gauge above it (`battle-gauge.ts`), bounded into a stretch by `battle-run.ts`.
// Three rules follow, and they are stated together because no one of them makes sense alone:
//
// 1. A fight does not end a conversation. The wipe into a battle is a legitimate gap of more than
//    `CONVERSATION_END_TICKS`, and the encounter that motivated all this split into three captures
//    on exactly that gap.
// 2. Nothing read while the gauge stands is kept, and everything written in the current *segment*
//    is taken back when it appears — so of a fight only the boxes after its last gauge frame
//    survive, which is where the beaten trainer speaks. The segment is what bounds the reach: it
//    begins where a conversation last ended and where a fight last lapsed, so a fight can never
//    retract the talk that led into it, nor a previous fight's tail.
// 3. The conversation after a fight is the same conversation, with no time limit — a beaten
//    trainer's line is what the player goes back for.
//
// A fight with **nothing to attach itself to** records nothing at all. Wild grass follows no
// conversation, and without that rule every encounter in it would reopen the last NPC talk and
// append EXP messages to it.
//
// All of it is off unless the active profile carries a `battleRect`: an unmeasured profile leaves
// every behaviour in this file exactly as it was before any of this existed.

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
      /**
       * Pictures the watcher wrote and then took back: a box in the middle of a scrolling run
       * whose text turned out to lie wholly under the two boxes around it — see `middle-frame.ts`.
       * Counted rather than done quietly, because a picture disappearing from the list is exactly
       * the kind of thing that has to be explained where it happens.
       */
      dropped: number
      /**
       * Conversations recorded into the pending-capture queue since the watcher was switched on —
       * one per `pending-capture/added`, never per box. Only counts with nothing selected; a
       * selected dialogue is appended to and has nothing new to count. A capture that turned out
       * to be a fight's intro is counted back off again when it is dropped.
       */
      conversations: number
      /**
       * Fights taken out since the watcher was switched on, one per fight rather than per box.
       * Counted for the reason `dropped` is: a fight silently deletes pictures that were on screen
       * a moment ago, and that has to be explained where it happens.
       */
      battles: number
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

/**
 * Consecutive gap polls that end a conversation — see `box-settle.ts`'s `conversationEnded` and
 * its module comment for what counts as a gap: not only a literally blank box, but any reading with
 * no legible dialogue continuing in it, which is what the screen behind a closed box reads as.
 *
 * 13 at `POLL_MS` is roughly 2.5 s: the value exists to outlast a blank between two boxes, a menu
 * opening mid-conversation, and a battle interrupting one, all of which unsettle the reading for a
 * few frames without the conversation actually being over. Long enough for those, short enough
 * that two NPCs standing next to each other still read as two conversations rather than one
 * run-on line — this is the one number in the issue that had to be tuned against a real game
 * rather than derived.
 */
const CONVERSATION_END_TICKS = 13

/**
 * How long the opponent's gauge may be gone before the fight counts as over.
 *
 * It exists to cover the boxes spoken **after** the last gauge frame, which is where a beaten
 * trainer speaks: in the recorded encounter those are `TeeResa besiegt KÄFERSAMMLER!`,
 * `KÄFERSAMMLER: Ah!` and `RAUPY hat es nicht geschafft!`, arriving as fast as the player presses
 * A. 25 at `POLL_MS` is 5 s — comfortably longer than that, and short enough that the fight has
 * stopped holding the conversation open before the player has walked anywhere.
 */
const BATTLE_LAPSE_TICKS = 25

/**
 * How long after a conversation ends a starting fight still belongs to it.
 *
 * **This is the number to re-check against a real game.** Measured once: in the recording, the
 * captures either side of the transition were created at `:23.259` and `:32.701`, and the first
 * gauge frame followed the second by two boxes — roughly 7.5 s from the conversation ending to the
 * fight being recognisable. 15 s is the generous side of that one measurement.
 *
 * A window is needed at all because a wild encounter follows no conversation. Without one, every
 * step through grass would reopen the last NPC talk and append EXP messages to it; with one, such
 * a fight has nothing to attach itself to and is therefore not recorded. The cost is stated rather
 * than hidden: a wild encounter *within* the window of an NPC conversation does attach to it, and
 * has to be separated by hand.
 */
const BATTLE_JOIN_MS = 15_000

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

/**
 * What the watcher writes into: a selected dialogue is appended to, and nothing selected records
 * captures into the queue. Decided by the selection alone — see the module comment and CLAUDE.md.
 */
type WatchTarget = { kind: 'dialogue'; id: DialogueId } | { kind: 'queue' }

/** What `settle` describes, as a key `===`-comparable across ticks. A box is only "already
 * written" for the target it was written into — a dialogue, or the queue, under one profile. */
let settledFor: { targetKey: string | null; profileId: CaptureProfileId | null } = {
  targetKey: null,
  profileId: null,
}

/**
 * The queue's conversation in progress, or `null` between conversations. Reset to `null` whenever
 * `settledFor` changes — a target switch or a profile change — and whenever `conversationEnded`
 * fires while writing into the queue, so the next settled box starts a fresh capture rather than
 * silently resuming one the player may have forgotten about.
 */
let currentCaptureId: PendingCaptureId | null = null

let failures = 0
/** Whether `replayHeldFrames` is writing. The tick stands down rather than interleaving with it. */
let replaying = false

/** Whether a fight is on, and how long its gauge has been away — see `battle-run.ts`. */
let battlePhase: BattlePhase = { kind: 'none' }

/**
 * One box the watcher wrote into the record it is writing into, in order.
 *
 * Module-level and never in the store, for the reason the file's opening comment gives for `settle`
 * and `heldFrames`: it is transient, unserialisable, and no part of the document. It exists because
 * a fight needs the one thing the watcher has never done — **un-write text**. `takeBack` may drop a
 * picture and leave the line alone, since the frames around a scrolled-through middle still carry
 * its words; a battle box carries words nothing else carries.
 *
 * `media` is `null` for a box whose picture `keepWindow` has already taken back. Its **text stays**
 * in the ledger, because it is still in the line, carried by the two frames around it.
 */
type LedgerBox = { media: DialogueMedia | null; text: string }

let ledger: LedgerBox[] = []
/** Which record `ledger` describes. A write into another one starts the ledger over. */
let ledgerOwner: WrittenOwner | null = null
/**
 * What the record said before the ledger's first box.
 *
 * Empty for a capture, which is created empty. **Not** empty for a selected dialogue, which may
 * already hold a line the user typed — and without this the fold could never match what the
 * document says, so the guard in `retractSegment` would refuse every retraction there.
 */
let ledgerBase = ''
/**
 * Where the current segment begins in `ledger` — the furthest back a fight may reach.
 *
 * Moved to the end of the ledger by **every** conversation end and **every** battle lapse, which is
 * what keeps a fight from retracting the talk that led into it or a previous fight's tail.
 */
let segmentStart = 0

/**
 * The conversation that just closed, kept so a fight beginning right after it can reopen it.
 *
 * Its ledger comes with it: a new capture clears the live ledger, and without a copy here the
 * reopened conversation could no longer re-fold its own text. `afterBattle` is what makes rule 3
 * unbounded — a conversation that ended out of a fight waits for the next one however long it takes.
 */
let previous: {
  captureId: PendingCaptureId
  closedAt: number
  afterBattle: boolean
  ledger: LedgerBox[]
  base: string
} | null = null

/** Whether the capture in progress has seen a gauge. Decides `previous.afterBattle` when it ends. */
let battleInCapture = false

/**
 * A fight that found nothing to attach itself to. Nothing is written until it lapses — not even the
 * boxes with no gauge on them, which in a wild encounter are the EXP and level-up messages.
 */
let suppressing = false

/** Which line or capture a written frame belongs to — the two things `keepWindow` can write into. */
type WrittenOwner = { kind: 'dialogue'; id: DialogueId } | { kind: 'queue'; id: PendingCaptureId }

function sameOwner(a: WrittenOwner, b: WrittenOwner): boolean {
  return a.kind === b.kind && a.id === b.id
}

/** One picture the watcher wrote, kept only long enough to judge the box that follows it. */
type WrittenFrame = { owner: WrittenOwner; media: DialogueMedia; text: string }

/**
 * The last two boxes written, oldest first — the window `middleAddsNothing` judges a middle in.
 *
 * Module-level and never in the store, for the reason the file's opening comment gives for `settle`
 * and `heldFrames`: it is transient, unserialisable, and no part of the document. It holds one
 * line's frames at a time; a write into another line clears it, because a replay walks several
 * lines in one pass and two boxes of different conversations have no window in common.
 */
let written: WrittenFrame[] = []

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
  settledFor = { targetKey: null, profileId: null }
  currentCaptureId = null
  written = []
  battlePhase = { kind: 'none' }
  ledger = []
  ledgerBase = ''
  ledgerOwner = null
  segmentStart = 0
  previous = null
  battleInCapture = false
  suppressing = false
  failures = 0
  // The held queue is deliberately not cleared: it survives the watcher being switched off and on,
  // because the alphabet is usually answered once the conversation is over.
  setState({
    kind: 'watching',
    appended: 0,
    repeated: 0,
    dropped: 0,
    conversations: 0,
    battles: 0,
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

  // The two modes, decided by the selection and by nothing else — no separate mode flag and no
  // override. A selected dialogue is appended to; anything else (nothing selected, or a zone or
  // map — neither has any bearing on the watcher) records into the pending-capture queue.
  const target: WatchTarget =
    app.selection.kind === 'dialogue' ? { kind: 'dialogue', id: app.selection.id } : { kind: 'queue' }

  if (target.kind === 'dialogue' && currentDialogue(target.id) === null) {
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

  // What the box last settled *against* is only meaningful for one target read under one profile:
  // switching targets without advancing the game leaves the box on screen unchanged, but it has
  // never been written to the new target. Same for a profile switched mid-conversation, which can
  // read the same pixels differently. A target switch also abandons any capture in progress in the
  // queue — resuming a forgotten conversation is worse than starting a fresh one.
  const targetKey = target.kind === 'dialogue' ? `dialogue:${target.id}` : 'queue'
  if (targetKey !== settledFor.targetKey || profile.id !== settledFor.profileId) {
    settle = NOTHING_SEEN
    settledFor = { targetKey, profileId: profile.id }
    currentCaptureId = null
    // The abandoned capture is not reopenable either: a target switch is the user saying where the
    // next box goes, and a fight must not overrule that. The ledger goes with it, so a fight in the
    // new target can never reach back into the record the old one was writing.
    previous = null
    battleInCapture = false
    ledger = []
    ledgerBase = ''
    ledgerOwner = null
    segmentStart = 0
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
  const step = nextSettle(
    settle,
    boxReadingFrom(readTextBox(frame, profile, glyphs)),
    SETTLE_TICKS,
    CONVERSATION_END_TICKS,
  )
  settle = step.state
  markRead()

  // One sample of the console's own pixels per tick, and only when the profile carries the
  // measurement — an unmeasured profile reads no gauge and every rule below stands down.
  const gauge =
    profile.battleRect !== null &&
    battleGaugeVisible(
      sampleNative(frame, profile.screenRect, profile.nativeWidth, profile.nativeHeight),
      profile.battleRect,
    )
  const fight = nextBattlePhase(battlePhase, gauge, BATTLE_LAPSE_TICKS)
  battlePhase = fight.phase
  // Every gauge tick takes the segment back, not only the first: the gauge goes dark for the box
  // saying the opponent fainted, and that box is written before the next gauge frame proves the
  // fight was not over. Retracting on each one is what leaves only the boxes after the *last*
  // gauge standing. It costs nothing once the segment is already empty.
  if (fight.started) await beginFight(target)
  else if (gauge) await retractSegment()
  if (fight.lapsed) endFight()
  // Both of those await file deletions, and a Stop or a target switch may have landed meanwhile.
  if (mine !== session) return

  // The box has been empty long enough that the conversation is over — unless a fight is on, in
  // which case the gap is the transition animation, a menu, or the fight itself, and the
  // conversation carries on across it. Only meaningful in the queue: a selected dialogue has no
  // notion of "conversation", only a line that keeps growing for as long as it is selected.
  if (step.conversationEnded && battlePhase.kind === 'none') {
    endSegment()
    if (target.kind === 'queue') closeConversation()
  }

  const settled = step.settled
  if (settled === null) return

  // A box read while the gauge stands is a box of the fight, and the fight has already taken back
  // everything written in this segment. A suppressed fight writes nothing at all until it lapses.
  if (gauge || suppressing) return

  if (target.kind === 'dialogue') {
    const dialogueId = target.id
    // A readable box goes into the queue too, once a box before it is waiting there: a held frame
    // can only ever be appended at the *end* of the line, so writing the boxes that came after it
    // would put the conversation down out of order — and `appendWithoutOverlap` would then join
    // the held one to the wrong suffix, or swallow it whole. Deferred work is the point of the
    // queue; a scrambled line is not.
    if (settled.kind === 'held' || holdsFrameFor(dialogueId)) {
      hold(dialogueId, frame)
      return
    }

    // The line as the field has it, before reading what the document says: `useFieldDraft` only
    // commits 300 ms after the last keystroke, and typing a word and clicking straight back into
    // the emulator would otherwise let this append land first — after which the draft yields to
    // the document and the typed characters are gone. The manual button flushes for the same
    // reason.
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
    return
  }

  // Queue mode. An unreadable box has nowhere to wait: `held`'s frame queue is keyed by
  // `DialogueId` and exists because a placed line can be revisited once the alphabet grows — a
  // conversation with no place yet, possibly no capture yet either, has neither. The box is
  // simply not captured; if it is still on screen once the alphabet can read it whole, it reads
  // as a change from this held signature and settles again.
  if (settled.kind === 'held') return

  try {
    switch (await writeIntoQueue(profile, frame, settled.text)) {
      case 'appended':
        countAppended(settled.text)
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
}

/**
 * One settled box into the pending-capture queue: the first box of a conversation creates the
 * capture, every later one appends to it — mirroring `writeBox`, but against a `PendingCapture`
 * rather than a `Dialogue`, since neither `store.ts` nor `capture-to-dialogue.ts` know about one.
 *
 * `currentCaptureId` names which capture that is; `null` means this settled box is the first of a
 * new conversation.
 */
async function writeIntoQueue(
  profile: CaptureProfile,
  frame: ImageData,
  transcript: string,
): Promise<'appended' | 'unchanged' | 'gone'> {
  // Checked before anything is written, exactly like `writeBox` checks the dialogue it is
  // appending to: a box that says nothing new a capture in progress does not already say must
  // not cost a picture. Only meaningful once a capture exists — a conversation's first box has
  // nothing yet to be unchanged against, so this is skipped for it.
  if (currentCaptureId !== null) {
    const existing = currentPendingCapture(currentCaptureId)
    if (existing === null) {
      // Placed or deleted since the last tick. Not 'gone' — the conversation itself is not gone,
      // only the capture that was holding it; falling through starts a fresh one for this box.
      currentCaptureId = null
    } else if (appendOutcome(existing.text, transcript).text !== 'appended') {
      return 'unchanged'
    }
  }

  if (currentCaptureId === null) openCapture()
  const captureId = currentCaptureId
  // `openCapture` only ever leaves this null with no project open, which the tick already refused.
  if (captureId === null) return 'gone'

  const { media } = await importDialogueMedia(captureId, await screenPng(frame, profile))
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
  const owner: WrittenOwner = { kind: 'queue', id: captureId }
  record(owner, media, transcript, into.text)
  await keepWindow(owner, media, transcript)
  return 'appended'
}

/**
 * The capture the next settled box goes into: the one a fight left waiting, or a new one.
 *
 * Rule 3 lives here. A conversation that ended out of a fight is not closed for good — a beaten
 * trainer's line is what the player goes back for, and it is the same encounter however long they
 * take, so the *next* conversation reopens it rather than starting its own.
 */
function openCapture(): void {
  if (previous !== null && previous.afterBattle) {
    reopen(previous)
    return
  }
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
  currentCaptureId = capture.id
  // A fresh capture starts a fresh ledger. `previous` is deliberately *not* cleared: its window is
  // still open, and a fight starting a box or two into this capture belongs to that conversation
  // rather than to this one — see `beginFight`.
  ledger = []
  ledgerBase = ''
  ledgerOwner = { kind: 'queue', id: capture.id }
  segmentStart = 0
  battleInCapture = false
  countConversation()
}

/** Picks a closed conversation back up, ledger and all, so it can still re-fold its own text. */
function reopen(entry: NonNullable<typeof previous>): void {
  currentCaptureId = entry.captureId
  ledger = entry.ledger
  ledgerBase = entry.base
  ledgerOwner = { kind: 'queue', id: entry.captureId }
  segmentStart = ledger.length
  battleInCapture = false
  previous = null
}

/**
 * The conversation is over. The capture is not dispatched away — it is simply no longer written
 * into, and is remembered in case a fight, or the conversation after a fight, claims it back.
 */
function closeConversation(): void {
  if (currentCaptureId !== null) {
    previous = {
      captureId: currentCaptureId,
      closedAt: Date.now(),
      afterBattle: battleInCapture,
      ledger,
      base: ledgerBase,
    }
  }
  currentCaptureId = null
  battleInCapture = false
}

/** Where a fight may no longer reach back to. Moved by every gap and every fight that lapses. */
function endSegment(): void {
  segmentStart = ledger.length
}

/**
 * A fight has just been recognised: take back what has been written of it, and decide whose fight
 * it is.
 *
 * The order matters. Retracting first is what empties the capture the fight's own intro created —
 * `KÄFERSAMMLER möchte kämpfen!` and `KÄFERSAMMLER setzt RAUPY ein!` are boxes of the fight, and
 * they arrive before any gauge does. Only once that capture says nothing is it clear that this
 * fight has no conversation of its own, and the one before it is asked for.
 */
async function beginFight(target: WatchTarget): Promise<void> {
  countBattle()
  battleInCapture = true
  await retractSegment()
  // A selected line has no notion of a conversation, so there is nothing to join or reopen; the
  // retraction above and the skipping in `tick` are the whole of the rule there.
  if (target.kind === 'dialogue') return

  dropEmptyCapture()
  if (currentCaptureId !== null) return

  const joinable =
    previous !== null && (previous.afterBattle || Date.now() - previous.closedAt <= BATTLE_JOIN_MS)
  if (joinable && previous !== null) reopen(previous)
  // Nothing to attach to: wild grass, or a fight long after anyone last spoke. Recording it would
  // put EXP messages under an NPC's name, so nothing is recorded until it lapses.
  else suppressing = true
}

/** A fight that lapsed leaves its tail standing, and out of reach of the next one. */
function endFight(): void {
  suppressing = false
  endSegment()
}

/** Drops a capture the retraction left empty — it is no longer a record of anything. */
function dropEmptyCapture(): void {
  if (currentCaptureId === null) return
  const capture = currentPendingCapture(currentCaptureId)
  if (capture !== null) {
    if (capture.text !== '' || capture.media.length > 0) return
    dispatch({ kind: 'pending-capture/deleted', captureId: currentCaptureId })
    uncountConversation()
  }
  currentCaptureId = null
  ledger = []
  ledgerBase = ''
  ledgerOwner = null
  segmentStart = 0
}

/**
 * Notes a box the watcher wrote, so a fight can take it back again.
 *
 * `before` is what the record said with this box not yet in it, and is kept only when the ledger
 * starts — see `ledgerBase`.
 */
function record(owner: WrittenOwner, media: DialogueMedia, text: string, before: string): void {
  if (ledgerOwner === null || !sameOwner(ledgerOwner, owner)) {
    ledger = []
    ledgerOwner = owner
    ledgerBase = before
    segmentStart = 0
  }
  ledger = [...ledger, { media, text }]
}

/** The line the ledger says the record holds. The only way the text is ever un-written. */
function foldLedger(boxes: readonly LedgerBox[]): string {
  return boxes.reduce((line, box) => appendWithoutOverlap(line, box.text), ledgerBase)
}

/**
 * Takes the current segment back out: the pictures, and — uniquely — the words.
 *
 * The text is **re-folded, not reversed**. Folding `appendWithoutOverlap` over the surviving ledger
 * is by construction the line that would have existed had the removed boxes never been written:
 * the same function, in the same order, over a shorter list. Nothing here inverts anything.
 *
 * It runs only while the record still says exactly what was folded into it. A line the user has
 * edited in the meantime is left alone entirely, pictures included — the same caution `takeBack`
 * applies to a picture the user removed by hand, and for the same reason.
 */
async function retractSegment(): Promise<void> {
  const owner = ledgerOwner
  if (owner === null || ledger.length <= segmentStart) return
  const held = recordText(owner)
  if (held === null || held !== foldLedger(ledger)) return

  const dropped = ledger.slice(segmentStart)
  ledger = ledger.slice(0, segmentStart)
  setRecordText(owner, foldLedger(ledger))
  for (const box of dropped) {
    if (box.media !== null) removeRecordMedia(owner, box.media.id)
  }
  // Document first, file after, for the reason `takeBack` gives: after the dispatch nothing in the
  // document names the file, and it would sit in media/ forever.
  for (const box of dropped) {
    if (box.media !== null) await discardMediaFile(box.media.file.fileName)
  }
  // A retracted frame must not go on being judged as the middle of a scrolling run.
  written = written.filter(
    (entry) => !dropped.some((box) => box.media !== null && box.media.id === entry.media.id),
  )
}

/** What the record says now, or `null` once it is gone. */
function recordText(owner: WrittenOwner): string | null {
  if (owner.kind === 'dialogue') return currentDialogue(owner.id)?.text ?? null
  return currentPendingCapture(owner.id)?.text ?? null
}

function setRecordText(owner: WrittenOwner, text: string): void {
  if (owner.kind === 'dialogue') dispatch({ kind: 'dialogue/text-set', dialogueId: owner.id, text })
  else dispatch({ kind: 'pending-capture/text-set', captureId: owner.id, text })
}

function removeRecordMedia(owner: WrittenOwner, mediaId: MediaId): void {
  if (owner.kind === 'dialogue') {
    dispatch({ kind: 'dialogue/media-removed', dialogueId: owner.id, mediaId })
  } else {
    dispatch({ kind: 'pending-capture/media-removed', captureId: owner.id, mediaId })
  }
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
 * One settled box into one line: the picture and what the box said that the line does not.
 *
 * The document as it stands **now**, never a copy taken before an await: a settled box is written
 * several hundred milliseconds after the tick that read it began, and a replayed one minutes
 * after. `unchanged` writes nothing at all — no picture and no dispatch — because a box that says
 * nothing new is the ordinary case for a loop reading four times a second, and a picture of it
 * would bury the conversation. Only the watcher applies that rule; a deliberate press still keeps
 * its frame.
 *
 * A box that *is* written can still be taken back once the box after it arrives — see `keepWindow`.
 * That too is the watcher's alone, and for the same reason: it fires unattended, so it is the one
 * caller that can judge a frame against what came after it rather than against a press.
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
  if (result.text !== 'appended') return 'unchanged'
  const owner: WrittenOwner = { kind: 'dialogue', id: dialogueId }
  record(owner, result.media, text, target.text)
  await keepWindow(owner, result.media, text)
  return 'appended'
}

/**
 * Slides the window on by one box, taking back the picture it pushes out of the middle.
 *
 * Here rather than in the tick, so a replayed frame is judged exactly as a live one is: both write
 * through `writeBox`, and a held box replayed in capture order sits in the same run of a scrolling
 * text box as the rest.
 *
 * The box that just landed is the *third* of the three, so the judgement is always about the one
 * before it — which is why nothing is ever taken back until a box after it exists. `before` is
 * empty for the first pair, and `middleAddsNothing` reads that as the question a filling box asks
 * rather than a scrolling one. After a removal `before` stays the anchor, so a whole run of
 * in-between boxes falls away one at a time as the run goes on.
 */
async function keepWindow(owner: WrittenOwner, media: DialogueMedia, text: string): Promise<void> {
  // A replay walks several lines in one pass, and two boxes of different conversations — or one
  // in a line and the next in the queue — have no window in common.
  if (written.length > 0 && !sameOwner(written[0].owner, owner)) written = []

  const middle = written.at(-1) ?? null
  const before = written.at(-2)?.text ?? ''
  const entry: WrittenFrame = { owner, media, text }

  if (middle !== null && middleAddsNothing(before, middle.text, text)) {
    // Written before the await, so a write landing underneath this one cannot judge the same middle
    // a second time and try to remove it twice.
    written = [...written.slice(0, -1), entry]
    await takeBack(middle.owner, middle.media)
    return
  }
  written = [...written, entry].slice(-2)
}

/**
 * Takes one picture back out: the document first, the file after.
 *
 * The order and the reason are the panel's own remove — after the dispatch nothing in the document
 * names the file, so it would sit in `media/` forever, invisible from inside the app. The line's
 * text is deliberately left as it stands: it was already joined from every box, and this frame's
 * words are all still in it, carried by the two frames around it.
 *
 * A picture the user removed by hand in the meantime is left alone, rather than relying on the
 * reducer's no-op and deleting a file the document may since have handed to something else. The
 * same holds for a capture placed or deleted in the meantime — `currentPendingCapture` returning
 * `null` is that check for the queue.
 */
async function takeBack(owner: WrittenOwner, media: DialogueMedia): Promise<void> {
  if (owner.kind === 'dialogue') {
    const target = currentDialogue(owner.id)
    if (target === null || !target.media.some((candidate) => candidate.id === media.id)) return
    dispatch({ kind: 'dialogue/media-removed', dialogueId: owner.id, mediaId: media.id })
  } else {
    const target = currentPendingCapture(owner.id)
    if (target === null || !target.media.some((candidate) => candidate.id === media.id)) return
    dispatch({ kind: 'pending-capture/media-removed', captureId: owner.id, mediaId: media.id })
  }
  await discardMediaFile(media.file.fileName)
  // The ledger keeps the box and loses its picture. Its words stay, because they are still in the
  // line — carried by the two frames around it, which is the whole reason this frame could go.
  ledger = ledger.map((box) =>
    box.media !== null && box.media.id === media.id ? { media: null, text: box.text } : box,
  )
  countDropped()
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

/** A conversation that turned out to be a fight's intro was never one. Counted back off. */
function uncountConversation(): void {
  if (state.kind !== 'watching' || state.conversations === 0) return
  setState({ ...state, conversations: state.conversations - 1 })
}

function countBattle(): void {
  if (state.kind !== 'watching') return
  setState({ ...state, battles: state.battles + 1 })
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

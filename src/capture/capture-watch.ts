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
  PendingCapture,
  PendingCaptureId,
} from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { activeCaptureProfile } from './active-profile.ts'
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
import { readTextBox } from './glyph-matcher.ts'
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
       * selected dialogue is appended to and has nothing new to count.
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
  failures = 0
  // The held queue is deliberately not cleared: it survives the watcher being switched off and on,
  // because the alphabet is usually answered once the conversation is over.
  setState({
    kind: 'watching',
    appended: 0,
    repeated: 0,
    dropped: 0,
    conversations: 0,
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

  // The box has been empty long enough that the conversation is over. Only meaningful in the
  // queue: a selected dialogue has no notion of "conversation", only a line that keeps growing for
  // as long as it is selected.
  if (step.conversationEnded && target.kind === 'queue') closeConversation()

  const settled = step.settled
  if (settled === null) return

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
  await keepWindow(owner, media, transcript)
  return 'appended'
}

/** The next settled box with nothing selected always starts a fresh conversation. */
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
  currentCaptureId = capture.id
  countConversation()
}

/** The conversation is over. The capture is not dispatched away — it is simply no longer written into. */
function closeConversation(): void {
  currentCaptureId = null
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

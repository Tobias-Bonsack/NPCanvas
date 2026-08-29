import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { useActiveCaptureProfile } from './active-profile.ts'
import { useCaptureSource } from './capture-session.ts'
import { captureBlocker } from './capture-to-dialogue.ts'
import type { WatchState } from './capture-watch.ts'
import {
  describeReplay,
  discardHeldFrames,
  heldUnknownTiles,
  replayHeldFrames,
  triggerRecording,
  useWatchState,
  useWatching,
} from './capture-watch.ts'
import { GlyphLearner } from './GlyphLearner.tsx'
import type { UnknownTile } from './glyph-matcher.ts'
import { mergeGlyphs } from './glyph-matcher.ts'
import { HeldNote } from './HeldNote.tsx'
import type { CaptureProfile, Glyph, PendingCapture } from '../project/types.ts'
import { dispatch, useAppStateExceptSave } from '../project/store.ts'
import { describeError } from '../storage/project-directory.ts'
import './CaptureRecorder.css'

/**
 * One round of answering — or throwing away — the held queue, as this region alone sees it. Its
 * own state, separate from a manual capture's: the two share nothing but a `CaptureProfile`, and
 * a learner opened over one must not disable the other.
 */
type HeldCaptureState =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | {
      kind: 'learning-held'
      profile: CaptureProfile
      glyphs: readonly Glyph[]
      tiles: readonly UnknownTile[]
    }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

/**
 * The watcher's two triggers and status, rendered in the canvas sidebar (moved here from `Nav.tsx`
 * in #106). What it produces is a pending capture, and pending captures live beside it in
 * `PendingCaptureList`.
 *
 * Two buttons, not a toggle: `New capture` always opens a fresh conversation, `Extend last` reopens
 * `pendingCaptures.at(-1)` — the same conversation picked back up, because a shopkeeper's second
 * line or the sentence after a fight belongs with what came before it (#107). Either one read as
 * `Stop` while a recording runs, and firing either then ends it; neither starts anything until it
 * has. There is deliberately no keyboard trigger — a bare letter is no use to a hand on a
 * controller, and the trigger the player will actually reach for is a bound controller button
 * (#110, #111).
 *
 * `HeldNote` is rendered here rather than from the dialogue panel (#109): a held frame belongs to
 * the capture the watcher was recording when it read it, not to whichever line happens to be
 * selected — #107 already made a selected line meaningless to the watcher, and the queue itself
 * lives beside the trigger that fills it.
 */
export function CaptureRecorder(): ReactElement {
  const appState = useAppStateExceptSave()
  const captureProfiles = appState.kind === 'ready' ? appState.project.captureProfiles : []
  const pendingCaptures = appState.kind === 'ready' ? appState.project.pendingCaptures : []
  const glyphs = appState.kind === 'ready' ? appState.project.glyphs : []
  const source = useCaptureSource()
  const profile = useActiveCaptureProfile(captureProfiles)
  const blocker = captureBlocker(source, profile)
  const watching = useWatching()
  const watch = useWatchState()

  const [heldState, setHeldState] = useState<HeldCaptureState>({ kind: 'idle' })
  const heldBusy = heldState.kind === 'capturing' || heldState.kind === 'learning-held'

  // `triggerRecording` is the one place that decides start versus stop — the buttons below and a
  // bound gamepad button (#111) both call it, so neither can drift from the other's rule. `blocker`
  // stays local: it is what each button's own `disabled` and `title` read, which is a rendering
  // concern this component still owns.
  function trigger(mode: 'new' | 'extend'): void {
    triggerRecording(mode)
  }

  /**
   * The held queue's questions, asked once for the whole queue.
   *
   * A queue that has nothing left to ask — the alphabet grew for another reason since — replays
   * straight away rather than opening a learner with no tiles in it.
   */
  function answerHeld(): void {
    if (heldBusy || profile === null) return
    const tiles = heldUnknownTiles(profile, glyphs)
    if (tiles.length === 0) {
      void replayHeld(profile, glyphs)
      return
    }
    setHeldState({ kind: 'learning-held', profile, glyphs, tiles })
  }

  /**
   * Empties the queue without writing any of it. The frames are the only record of those boxes, so
   * `HeldNote` asks first — this runs after that answer, and says how much went.
   */
  function discardHeld(): void {
    const waiting = discardHeldFrames()
    setHeldState({
      kind: 'done',
      message:
        waiting === 1
          ? '1 waiting box was discarded. Nothing was written.'
          : `${waiting} waiting boxes were discarded. Nothing was written.`,
    })
  }

  async function replayHeld(target: CaptureProfile, alphabet: readonly Glyph[]): Promise<void> {
    setHeldState({ kind: 'capturing' })
    try {
      setHeldState({
        kind: 'done',
        message: describeReplay(await replayHeldFrames(target, alphabet)),
      })
    } catch (error) {
      // `replayHeldFrames` keeps a frame it could not write, so nothing is lost here — but the
      // region must not be left reading "Writing…" with every control disabled behind it.
      setHeldState({ kind: 'failed', message: describeError(error) })
    }
  }

  function onHeldGlyphsLearned(
    target: CaptureProfile,
    alphabet: readonly Glyph[],
    learned: Glyph[],
  ): void {
    dispatch({ kind: 'glyphs/learned', glyphs: learned })
    // The store's own copy arrives on the next render and the frames are being re-read now, so
    // the grown alphabet is applied here through the same merge the reducer just ran — as
    // `CaptureBar` and `DialoguePanel` do.
    void replayHeld(target, mergeGlyphs(alphabet, learned))
  }

  const last: PendingCapture | undefined = pendingCaptures.at(-1)
  const extendTitle =
    last === undefined
      ? 'Nothing to extend yet — starts a new capture, same as New capture'
      : `Add to "${last.npcName}", the last capture recorded`

  return (
    <div className="capture-recorder">
      <h2 className="map-list__heading micro-label">Captures</h2>
      <div className="capture-recorder__watch">
        <WatcherStatus watch={watch} pendingCaptures={pendingCaptures} />
        <div className="capture-recorder__triggers">
          <button
            type="button"
            className="capture-recorder__watch-toggle button"
            data-watching={watching ? 'true' : undefined}
            aria-pressed={watching}
            disabled={blocker !== null && !watching}
            title={
              watching
                ? 'Stop reading the text box'
                : (blocker ??
                  'Start a new conversation — every box that comes to rest is recorded into it')
            }
            onClick={() => trigger('new')}
          >
            {watching ? 'Stop' : 'New capture'}
          </button>
          <button
            type="button"
            className="capture-recorder__watch-toggle button"
            data-watching={watching ? 'true' : undefined}
            aria-pressed={watching}
            disabled={blocker !== null && !watching}
            title={watching ? 'Stop reading the text box' : (blocker ?? extendTitle)}
            onClick={() => trigger('extend')}
          >
            {watching ? 'Stop' : 'Extend last'}
          </button>
        </div>
      </div>
      <HeldNote
        onAnswer={answerHeld}
        onDiscard={discardHeld}
        answerDisabled={heldBusy || profile === null}
        discardDisabled={heldBusy}
      />
      {heldState.kind === 'done' && (
        <p className="capture-recorder__watch-note" role="status">
          {heldState.message}
        </p>
      )}
      {heldState.kind === 'failed' && (
        <p className="capture-recorder__held-error" role="alert">
          {heldState.message}
        </p>
      )}
      {/* Cancelling here discards nothing at all: the held frames are still in the queue, and the
          control that opened this is still right above it. */}
      {heldState.kind === 'learning-held' && (
        <GlyphLearner
          tiles={heldState.tiles}
          cancelLabel="Cancel"
          onCancel={() => setHeldState({ kind: 'idle' })}
          onConfirm={(learned) => onHeldGlyphsLearned(heldState.profile, heldState.glyphs, learned)}
        />
      )}
    </div>
  )
}

/**
 * What the watcher is doing, in the one place that stays in view while the game runs beside it.
 *
 * Its own component with its own subscription to `WatchState`, so a box appended re-renders this
 * line and not the rest of `CaptureRecorder` — and its own one-second tick, because "read 40 s ago"
 * has to keep counting while the watcher is paused and publishing nothing at all.
 */
function WatcherStatus({
  watch,
  pendingCaptures,
}: {
  watch: WatchState
  pendingCaptures: readonly PendingCapture[]
}): ReactElement | null {
  const ticking = watch.kind === 'watching'
  const [, retick] = useState(0)

  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => retick((count) => count + 1), 1000)
    return () => clearInterval(timer)
  }, [ticking])

  if (watch.kind === 'off') {
    // A watcher switched off by hand says nothing; one that stopped itself has to.
    return watch.message === null ? null : (
      <p className="capture-recorder__watch-note" role="alert">
        Watching stopped. {watch.message}
      </p>
    )
  }

  return (
    <div className="capture-recorder__watch-status">
      {/* The last line written is a hover tooltip rather than a quoted line of its own — a glance-at
          confirmation, not the record. */}
      <p className="capture-recorder__watch-note" title={watch.lastText ?? undefined}>
        {watchSummary(watch, watchTarget(watch, pendingCaptures))}
      </p>
      {watch.paused !== null && (
        <p className="capture-recorder__watch-paused hint-text" role="status">
          {watch.paused}
        </p>
      )}
    </div>
  )
}

/**
 * What the watcher writes into, in words — never an icon or a colour alone, so it reads correctly
 * from the corner of the eye while the game has the player's attention. Queue mode is the only
 * mode (#107): the watcher never writes into a selected dialogue, so this describes `captureId`
 * alone.
 */
function watchTarget(
  watch: Extract<WatchState, { kind: 'watching' }>,
  pendingCaptures: readonly PendingCapture[],
): string {
  if (watch.captureId === null) return 'Recording a new conversation'
  const capture = pendingCaptures.find((candidate) => candidate.id === watch.captureId)
  const name = capture?.npcName.trim() ?? ''
  return name === '' ? 'Recording into an unnamed capture' : `Recording into ${name}`
}

/** The counters as one line: what has been written, what is waiting, and how long since a read. */
function watchSummary(watch: Extract<WatchState, { kind: 'watching' }>, target: string): string {
  const parts = [
    watch.appended === 1 ? '1 box appended' : `${watch.appended} boxes appended`,
    watch.conversations === 0
      ? null
      : watch.conversations === 1
        ? '1 conversation recorded'
        : `${watch.conversations} conversations recorded`,
    watch.repeated === 0 ? null : `${watch.repeated} said nothing new`,
    // A picture vanishing from the list is exactly the kind of thing that has to be said where it
    // happens, rather than left to be noticed.
    watch.dropped === 0
      ? null
      : `${watch.dropped} in-between ${watch.dropped === 1 ? 'picture' : 'pictures'} dropped`,
    sinceRead(watch.lastReadAt),
  ]
  return `${target} · ${parts.filter((part) => part !== null).join(' · ')}`
}

/** How long ago the last frame was read, at the resolution the watcher publishes it in. */
function sinceRead(lastReadAt: number | null): string {
  if (lastReadAt === null) return 'nothing read yet'
  const seconds = Math.max(0, Math.round((Date.now() - lastReadAt) / 1000))
  if (seconds < 2) return 'reading'
  if (seconds < 60) return `read ${seconds} s ago`
  return `read ${Math.floor(seconds / 60)} min ago`
}

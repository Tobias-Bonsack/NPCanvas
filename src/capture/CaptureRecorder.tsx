import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { useActiveCaptureProfile } from './active-profile.ts'
import { useCaptureSource } from './capture-session.ts'
import { captureBlocker } from './capture-to-dialogue.ts'
import type { WatchState } from './capture-watch.ts'
import { startRecording, stopRecording, useWatchState, useWatching } from './capture-watch.ts'
import type { PendingCapture } from '../project/types.ts'
import { useAppStateExceptSave } from '../project/store.ts'
import './CaptureRecorder.css'

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
 */
export function CaptureRecorder(): ReactElement {
  const appState = useAppStateExceptSave()
  const captureProfiles = appState.kind === 'ready' ? appState.project.captureProfiles : []
  const pendingCaptures = appState.kind === 'ready' ? appState.project.pendingCaptures : []
  const source = useCaptureSource()
  const profile = useActiveCaptureProfile(captureProfiles)
  const blocker = captureBlocker(source, profile)
  const watching = useWatching()
  const watch = useWatchState()

  /**
   * Stopping is unconditional: the connection can end while the loop runs, and a trigger that
   * refused to stop would leave it switched on with no way back. Starting is not — a blocker
   * means there is nothing to read, and starting into a paused loop says the opposite of what
   * happened. Same rule as each button's `disabled`, in one place so they cannot drift.
   */
  function trigger(mode: 'new' | 'extend'): void {
    if (watching) stopRecording()
    else if (blocker === null) startRecording(mode)
  }

  const last: PendingCapture | undefined = pendingCaptures.at(-1)
  const extendTitle =
    last === undefined
      ? 'Nothing to extend yet — starts a new capture, same as New capture'
      : `Add to "${last.npcName}", the last capture recorded`

  return (
    <div className="capture-recorder">
      <h2 className="map-list__heading">Captures</h2>
      <div className="capture-recorder__watch">
        <WatcherStatus watch={watch} pendingCaptures={pendingCaptures} />
        <div className="capture-recorder__triggers">
          <button
            type="button"
            className="capture-recorder__watch-toggle"
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
            className="capture-recorder__watch-toggle"
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
        <p className="capture-recorder__watch-paused" role="status">
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

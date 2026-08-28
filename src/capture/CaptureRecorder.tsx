import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useActiveCaptureProfile } from './active-profile.ts'
import { useCaptureSource } from './capture-session.ts'
import { captureBlocker } from './capture-to-dialogue.ts'
import type { WatchState } from './capture-watch.ts'
import { startWatching, stopWatching, useWatchState, useWatching } from './capture-watch.ts'
import { clearSelection } from '../app/select.ts'
import type { Dialogue, Selection } from '../project/types.ts'
import { useAppStateExceptSave } from '../project/store.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import './CaptureRecorder.css'

/**
 * Switching the watcher on and off, as one unmodified key.
 *
 * Bare rather than a chord, and one letter rather than two, because of when it is pressed: a
 * conversation starts and ends while the hand is on the emulator's controls, so the gesture has to
 * be cheaper than reaching for the panel. `w` is free — the canvas tools own `i`, `p`, `z` and `m`,
 * and the viewport `f`, `0`, `+` and `-`.
 *
 * Unmodified letters are also exactly what an NPC name is made of, so the listener stands down for
 * a focused text field the same way `MapScreen`'s tool shortcuts do.
 */
const WATCH_KEY = 'w'
const WATCH_SHORTCUT = 'W'

/**
 * The watcher's toggle and status, reachable from every view via the `w` hotkey but rendered only
 * in the canvas sidebar — moved here from `Nav.tsx` in #106, once the watcher stopped needing the
 * top bar's permanent visibility for anything but the shortcut itself. What it produces is a
 * pending capture, and pending captures live beside it in `PendingCaptureList`.
 */
export function CaptureRecorder(): ReactElement {
  const appState = useAppStateExceptSave()
  const captureProfiles = appState.kind === 'ready' ? appState.project.captureProfiles : []
  const dialogues = appState.kind === 'ready' ? appState.project.dialogues : []
  const selection = appState.kind === 'ready' ? appState.selection : { kind: 'none' as const }
  const source = useCaptureSource()
  const profile = useActiveCaptureProfile(captureProfiles)
  const blocker = captureBlocker(source, profile)
  const watching = useWatching()

  /**
   * Stopping is unconditional: the connection can end while the loop runs, and a toggle that
   * refused to stop would leave it switched on with no way back. Starting is not — a blocker
   * means there is nothing to read, and switching on into a paused loop says the opposite of
   * what happened. Same rule as the button's `disabled`, in one place so the two cannot drift.
   */
  function toggle(): void {
    if (watching) stopWatching()
    else if (blocker === null) startWatching()
  }

  // Both halves change on every render — `watching` on each toggle, `blocker` whenever the
  // connection or the profile does — so a ref keeps the global key binding stable while the
  // shortcut still runs the current toggle.
  const toggleRef = useRef(toggle)
  useEffect(() => {
    toggleRef.current = toggle
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.toLowerCase() !== WATCH_KEY) return
      if (isTextFieldFocused()) return
      event.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="capture-recorder">
      <h2 className="map-list__heading">Captures</h2>
      <div className="capture-recorder__watch">
        <WatcherStatus selection={selection} dialogues={dialogues} />
        {/* Absent rather than disabled when nothing is selected: there is nothing to clear, and a
            control that is sometimes there and sometimes not is more honest than one that is always
            there and sometimes does nothing. The selection *is* the mode (#69) — this is simply the
            one visible way to switch it to queue mode, beside Escape and the bare-canvas click. */}
        {selection.kind === 'dialogue' && (
          <button
            type="button"
            className="capture-recorder__watch-clear"
            onClick={clearSelection}
            title="Stop writing into this pin — the watcher records new conversations instead"
          >
            Stop writing into this pin
          </button>
        )}
        <button
          type="button"
          className="capture-recorder__watch-toggle"
          data-watching={watching ? 'true' : undefined}
          aria-pressed={watching}
          // Stopping must always be possible: the connection can end while the loop runs, and a
          // toggle that disabled itself would leave it stuck on.
          disabled={blocker !== null && !watching}
          title={
            watching
              ? `Stop reading the text box — ${WATCH_SHORTCUT}`
              : (blocker ??
                `Read the text box while you play — every box that comes to rest is appended to ` +
                  `the selected line, or recorded as a new conversation with nothing selected. ` +
                  WATCH_SHORTCUT)
          }
          onClick={toggle}
        >
          {watching ? 'Stop watching' : 'Watch the text box'} · {WATCH_SHORTCUT}
        </button>
      </div>
    </div>
  )
}

/**
 * What the watcher is doing, in the one place that stays in view while the game runs beside it.
 *
 * Its own component with its own subscription to `WatchState`, so a box appended re-renders this
 * line and not the rest of `CaptureRecorder` — and its own one-second tick, because "read 40 s ago"
 * has to keep counting while the watcher is paused and publishing nothing at all. `selection` and
 * `dialogues` are still read from the parent's own subscription rather than a second one here,
 * since `CaptureRecorder` already has them for the clear-selection control beside this.
 */
function WatcherStatus({
  selection,
  dialogues,
}: {
  selection: Selection
  dialogues: readonly Dialogue[]
}): ReactElement | null {
  const watch = useWatchState()
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
        {watchSummary(watch, watchTarget(selection, dialogues))}
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
 * from the corner of the eye while the game has the player's attention. Mirrors exactly what
 * `capture-watch.ts`'s own `tick` decides the target is: the selection, and nothing else.
 */
function watchTarget(selection: Selection, dialogues: readonly Dialogue[]): string {
  if (selection.kind !== 'dialogue') return 'Recording new captures'
  const dialogue = dialogues.find((candidate) => candidate.id === selection.id)
  if (dialogue === undefined) return 'Recording new captures'
  const name = dialogue.npcName.trim()
  // An unnamed pin is exactly the state you are in right after placing one — it still has to be
  // identified as *something*, not silently described as if nothing were selected.
  return name === '' ? 'Writing into an unnamed pin' : `Writing into ${name}`
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

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import { useActiveCaptureProfile } from '../capture/active-profile.ts'
import { useCaptureSource } from '../capture/capture-session.ts'
import { captureBlocker } from '../capture/capture-to-dialogue.ts'
import type { WatchState } from '../capture/capture-watch.ts'
import { startWatching, stopWatching, useWatchState, useWatching } from '../capture/capture-watch.ts'
import { describeJoinWindow } from '../capture/join-window.ts'
import type { Dialogue, History, SaveState, Selection } from '../project/types.ts'
import { dispatch, useAppStateExceptSave, useHistoryState, useSaveState } from '../project/store.ts'
import { saveNow } from '../storage/autosave.ts'
import { connectToNewDirectory } from '../storage/project-directory.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { clearSelection } from './select.ts'
import type { Route } from './route.ts'
import { formatRoute, navigate, useRoute } from './route.ts'
import './Nav.css'

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

// Real anchors, not buttons: the hash is the navigation mechanism, so middle-click,
// bookmarking, and the back button all work without any handler of ours.
const NAV_ITEMS: readonly { label: string; route: Route }[] = [
  { label: 'Canvas', route: { kind: 'canvas', dialogueId: null, focus: null } },
  { label: 'Quests', route: { kind: 'quests', editQuestId: null } },
  { label: 'Insights', route: { kind: 'insights' } },
  { label: 'Settings', route: { kind: 'settings' } },
]

export function Nav({
  directoryName,
  onReviewSaveFailure,
}: {
  /** The connected folder, named here because it is the only place the app says which project
   * is open — and the switch below is the only way to open a different one. */
  directoryName: string
  /** Reopens a save-failure banner the user dismissed. Without it, dismissing the banner would
   * take the retry away with it and leave the failure with no action at all. */
  onReviewSaveFailure: () => void
}): ReactElement {
  const active = useRoute()
  // Its own subscription, not a prop: a save cycle then re-renders this indicator and nothing
  // else. `App` deliberately subscribes to the state *without* `save` for the same reason.
  const save = useSaveState()
  const history = useHistoryState()
  return (
    <nav className="nav" aria-label="Views">
      <span className="nav__brand">NPCanvas</span>
      <ul className="nav__list">
        {NAV_ITEMS.map((item) => (
          <li key={item.label}>
            <a
              className="nav__link"
              href={formatRoute(item.route)}
              aria-current={item.route.kind === active.kind ? 'page' : undefined}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
      {history !== null && <HistoryControls history={history} />}
      <WatcherControl />
      <ProjectSwitch directoryName={directoryName} />
      {/* One region for the whole session, its contents swapped underneath. A live region only
          announces what changes *inside* it — mounting one that already holds the new text says
          nothing at all, which is what a per-state `role="status"` would have done. */}
      <div className="nav__save-region" role="status">
        {save !== null && <SaveIndicator save={save} onReview={onReviewSaveFailure} />}
      </div>
    </nav>
  )
}

/**
 * Undo/redo, both as a Ctrl/Cmd+Z-family shortcut and as buttons whose disabled state mirrors
 * the stacks. No target check on the shortcut — Ctrl+Z fires even while a text field has focus,
 * which is deliberate: the reducer coalesces a burst of keystrokes into one step (see
 * `coalesceKeyFor` in reducer.ts), so app-level undo already behaves like the field's own undo
 * would, and a native browser undo racing it against a different snapshot is worse.
 */
function HistoryControls({ history }: { history: History }): ReactElement {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      dispatch({ kind: event.shiftKey ? 'history/redo' : 'history/undo' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="nav__history">
      <button
        type="button"
        className="nav__history-button"
        disabled={history.undo.length === 0}
        onClick={() => dispatch({ kind: 'history/undo' })}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        type="button"
        className="nav__history-button"
        disabled={history.redo.length === 0}
        onClick={() => dispatch({ kind: 'history/redo' })}
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
      >
        Redo
      </button>
    </div>
  )
}

/**
 * Which folder is open, and the way to open another one.
 *
 * The order inside the handler is the whole subtlety. `saveNow()` is synchronous, so the
 * pending edit is on its way to the *current* folder before the picker exists — and opening
 * the new project leaves `ready`, which drops any debounce still waiting. The picker is then
 * the first `await`, which is what `showDirectoryPicker` requires of its user gesture.
 */
function ProjectSwitch({ directoryName }: { directoryName: string }): ReactElement {
  async function onSwitch(): Promise<void> {
    saveNow()
    const opened = await connectToNewDirectory()
    // Ids in the hash belong to the project that has just been closed, so the switch lands on
    // a bare canvas rather than a link into a document that no longer contains it.
    if (opened) navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
  }

  return (
    <button
      type="button"
      className="nav__project"
      onClick={() => void onSwitch()}
      title={`Open a different project folder — ${directoryName} is connected`}
    >
      <span className="nav__project-name">{directoryName}</span>
      <span className="nav__project-action">Switch…</span>
    </button>
  )
}

/**
 * The watcher's toggle and status, reachable from every view — moved here from the dialogue
 * panel in #69, since a selected pin is no longer what makes the watcher useful: with nothing
 * selected it records conversations into the pending-capture queue instead of appending to a
 * line. See `src/capture/capture-watch.ts`'s module comment.
 */
function WatcherControl(): ReactElement {
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
    <div className="nav__watch">
      <WatcherStatus selection={selection} dialogues={dialogues} />
      {/* Absent rather than disabled when nothing is selected: there is nothing to clear, and a
          control that is sometimes there and sometimes not is more honest than one that is always
          there and sometimes does nothing. The selection *is* the mode (#69) — this is simply the
          one visible way to switch it to queue mode, beside Escape and the bare-canvas click. */}
      {selection.kind === 'dialogue' && (
        <button
          type="button"
          className="nav__watch-clear"
          onClick={clearSelection}
          title="Stop writing into this pin — the watcher records new conversations instead"
        >
          Stop writing into this pin
        </button>
      )}
      <button
        type="button"
        className="nav__watch-toggle"
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
  )
}

/**
 * What the watcher is doing, in the one place that stays in view while the game runs beside it —
 * moved here from the dialogue panel in #69, which its queue mode no longer needs open at all.
 *
 * Its own component with its own subscription to `WatchState`, so a box appended re-renders this
 * line and not the rest of `Nav` — and its own one-second tick, because "read 40 s ago" has to
 * keep counting while the watcher is paused and publishing nothing at all. `selection` and
 * `dialogues` are still read from the parent's own subscription rather than a second one here,
 * since `WatcherControl` already has them for the clear-selection control beside this.
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
      <p className="nav__watch-note" role="alert">
        Watching stopped. {watch.message}
      </p>
    )
  }

  return (
    <div className="nav__watch-status">
      {/* The last line written is a hover tooltip rather than a quoted line of its own — the bar
          has no room for a third line, and it is a glance-at confirmation, not the record. */}
      <p className="nav__watch-note" title={watch.lastText ?? undefined}>
        {watchSummary(watch, watchTarget(selection, dialogues))}
      </p>
      {watch.paused !== null && (
        <p className="nav__watch-paused" role="status">
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
    // Said for the same reason, and said louder: a fight takes back everything written of it, so
    // several pictures can disappear at once.
    watch.battles === 0
      ? null
      : `${watch.battles} ${watch.battles === 1 ? 'fight' : 'fights'} left out`,
    // Whether the fight you are walking into extends the conversation you just had. It needs no
    // timer of its own: `markRead` publishes a fresh state on every whole second the watcher
    // reads, which is the resolution a seconds countdown renders at — the same mechanism
    // `sinceRead` below already relies on.
    watch.joining === null ? null : describeJoinWindow(watch.joining, Date.now()),
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

// Intl rather than a date library: the timestamp only ever needs a wall clock, and the
// user's own locale is the right format for it. See CLAUDE.md § Dependencies.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Exhaustive over `SaveState`; the `ReactElement` return type rejects a new variant. */
function SaveIndicator({ save, onReview }: { save: SaveState; onReview: () => void }): ReactElement {
  switch (save.kind) {
    case 'saved':
      return (
        <p className="nav__save" data-state="saved">
          Saved {TIME_FORMAT.format(new Date(save.at))}
        </p>
      )

    case 'pending':
      return (
        <p className="nav__save" data-state="pending">
          Unsaved changes
        </p>
      )

    case 'saving':
      return (
        <p className="nav__save" data-state="saving">
          Saving…
        </p>
      )

    case 'failed':
      // The reason and the action live in the banner, which is where they fit; this stays the
      // persistent marker, and clicking it brings the banner back after a dismissal.
      return (
        <p className="nav__save" data-state="failed">
          <button type="button" className="nav__save-review" onClick={onReview}>
            Save failed
          </button>
        </p>
      )

    default:
      return assertNever(save)
  }
}

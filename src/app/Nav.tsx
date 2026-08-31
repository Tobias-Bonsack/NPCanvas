import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import type { History, SaveState } from '../project/types.ts'
import { dispatch, useHistoryState, useSaveState } from '../project/store.ts'
import { saveNow } from '../storage/autosave.ts'
import { connectToNewDirectory } from '../storage/project-directory.ts'
import type { Route } from './route.ts'
import { formatRoute, navigate, useRoute } from './route.ts'
import './app.css'

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
  directoryName: string
  // Reopens a save-failure banner the user dismissed, so dismissing it doesn't lose the retry.
  onReviewSaveFailure: () => void
}): ReactElement {
  const active = useRoute()
  // Its own subscription, not a prop — a save cycle then re-renders only this indicator.
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
      <ProjectSwitch directoryName={directoryName} />
      {/* One region for the whole session, contents swapped underneath — a live region only
          announces changes inside it, so a fresh per-state region would announce nothing. */}
      <div className="nav__save-region" role="status">
        {save !== null && <SaveIndicator save={save} onReview={onReviewSaveFailure} />}
      </div>
    </nav>
  )
}

// No target check on the shortcut — Ctrl+Z fires even in a text field, deliberately: the
// reducer coalesces a burst of keystrokes into one step, so this already behaves like the
// field's own undo, and a native browser undo racing it against a different snapshot is worse.
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
        className="nav__history-button button"
        disabled={history.undo.length === 0}
        onClick={() => dispatch({ kind: 'history/undo' })}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        type="button"
        className="nav__history-button button"
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

// saveNow() is synchronous so the pending edit is on its way to the current folder before the
// picker exists; the picker is then the first await, as showDirectoryPicker's gesture requires.
function ProjectSwitch({ directoryName }: { directoryName: string }): ReactElement {
  async function onSwitch(): Promise<void> {
    saveNow()
    const opened = await connectToNewDirectory()
    // Ids in the hash belong to the project just closed, so land on a bare canvas instead.
    if (opened) navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
  }

  return (
    <button
      type="button"
      className="nav__project button"
      onClick={() => void onSwitch()}
      title={`Open a different project folder — ${directoryName} is connected`}
    >
      <span className="nav__project-name">{directoryName}</span>
      <span className="nav__project-action">Switch…</span>
    </button>
  )
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function SaveIndicator({ save, onReview }: { save: SaveState; onReview: () => void }): ReactElement {
  switch (save.kind) {
    case 'saved':
      return (
        <p className="nav__save hint-text" data-state="saved">
          Saved {TIME_FORMAT.format(new Date(save.at))}
        </p>
      )

    case 'pending':
      return (
        <p className="nav__save hint-text" data-state="pending">
          Unsaved changes
        </p>
      )

    case 'saving':
      return (
        <p className="nav__save hint-text" data-state="saving">
          Saving…
        </p>
      )

    case 'failed':
      // The reason and action live in the banner; this stays the persistent marker.
      return (
        <p className="nav__save hint-text" data-state="failed">
          <button type="button" className="nav__save-review button" onClick={onReview}>
            Save failed
          </button>
        </p>
      )

    default:
      return assertNever(save)
  }
}

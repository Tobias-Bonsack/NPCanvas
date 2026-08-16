import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import type { SaveState } from '../project/types.ts'
import { saveNow } from '../storage/autosave.ts'
import { connectToNewDirectory } from '../storage/project-directory.ts'
import type { Route } from './route.ts'
import { formatRoute, navigate, useRoute } from './route.ts'
import './Nav.css'

// Real anchors, not buttons: the hash is the navigation mechanism, so middle-click,
// bookmarking, and the back button all work without any handler of ours.
const NAV_ITEMS: readonly { label: string; route: Route }[] = [
  { label: 'Canvas', route: { kind: 'canvas', dialogueId: null, focusMapId: null } },
  { label: 'Quests', route: { kind: 'quests', editQuestId: null } },
  { label: 'Insights', route: { kind: 'insights' } },
]

export function Nav({
  save,
  directoryName,
}: {
  save: SaveState
  /** The connected folder, named here because it is the only place the app says which project
   * is open — and the switch below is the only way to open a different one. */
  directoryName: string
}): ReactElement {
  const active = useRoute()
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
      <ProjectSwitch directoryName={directoryName} />
      <SaveIndicator save={save} />
    </nav>
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
    if (opened) navigate({ kind: 'canvas', dialogueId: null, focusMapId: null }, { replace: true })
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

// Intl rather than a date library: the timestamp only ever needs a wall clock, and the
// user's own locale is the right format for it. See CLAUDE.md § Dependencies.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Exhaustive over `SaveState`; the `ReactElement` return type rejects a new variant. */
function SaveIndicator({ save }: { save: SaveState }): ReactElement {
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
      return (
        <p className="nav__save" data-state="failed">
          <span title={save.message}>Save failed</span>
          <button type="button" className="nav__retry" onClick={saveNow}>
            Retry
          </button>
        </p>
      )

    default:
      return assertNever(save)
  }
}

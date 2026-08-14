import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import type { SaveState } from '../project/types.ts'
import { retrySave } from '../storage/autosave.ts'
import type { Route } from './route.ts'
import { formatRoute, useRoute } from './route.ts'
import './Nav.css'

// Real anchors, not buttons: the hash is the navigation mechanism, so middle-click,
// bookmarking, and the back button all work without any handler of ours.
const NAV_ITEMS: readonly { label: string; route: Route }[] = [
  { label: 'Canvas', route: { kind: 'canvas', dialogueId: null, focusMapId: null } },
  { label: 'Quests', route: { kind: 'quests' } },
  { label: 'Insights', route: { kind: 'insights' } },
]

export function Nav({ save }: { save: SaveState }): ReactElement {
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
      <SaveIndicator save={save} />
    </nav>
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
          <button type="button" className="nav__retry" onClick={retrySave}>
            Retry
          </button>
        </p>
      )

    default:
      return assertNever(save)
  }
}

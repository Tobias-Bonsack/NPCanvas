import type { ReactElement } from 'react'
import type { Route } from './route.ts'
import { formatRoute, useRoute } from './route.ts'
import './Nav.css'

// Real anchors, not buttons: the hash is the navigation mechanism, so middle-click,
// bookmarking, and the back button all work without any handler of ours.
const NAV_ITEMS: readonly { label: string; route: Route }[] = [
  { label: 'Map', route: { kind: 'map', mapId: null, dialogueId: null } },
  { label: 'Quests', route: { kind: 'quests' } },
  { label: 'Insights', route: { kind: 'insights' } },
]

export function Nav(): ReactElement {
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
    </nav>
  )
}

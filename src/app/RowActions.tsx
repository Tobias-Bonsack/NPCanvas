import type { ReactElement, ReactNode } from 'react'
import './RowActions.css'

/**
 * A row's verbs — Rename, Colour, Delete and whatever else a row carries — collapsed to nothing
 * until the row that owns them is hovered or holds focus. The host element (the row's own `<li>`
 * or header) opts in with the `row-actions-host` class; this component only supplies the group
 * that collapses under it, so a drag grip or a count that must stay visible can sit beside it,
 * outside the group.
 *
 * The collapse is a width, not just an opacity: idle, the verbs give their width back to the
 * row's own name rather than leaving it reserved for buttons nobody can see. See CLAUDE.md.
 */
export function RowActions({ children }: { children: ReactNode }): ReactElement {
  return <div className="row-actions">{children}</div>
}

import type { ReactElement, ReactNode } from 'react'
import './app.css'

/**
 * Reference material one click away from the control it explains, rather than permanently on
 * screen — a native `<details>`/`<summary>` rather than a `title` tooltip, which is unreachable
 * by keyboard and invisible on touch. Its open/closed state lives in the DOM node itself: never
 * the store, never the URL. See CLAUDE.md.
 */
export function Disclosure({ children }: { children: ReactNode }): ReactElement {
  return (
    <details className="disclosure">
      <summary className="disclosure__summary disclosure-summary">More</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  )
}

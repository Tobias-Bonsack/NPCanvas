import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { connectToNewDirectory, describeError } from '../storage/project-directory.ts'
import './ErrorBoundary.css'

/** `ok` carries no message and `caught` always has one — a nullable field would allow neither. */
type ErrorBoundaryState = { kind: 'ok' } | { kind: 'caught'; message: string }

/**
 * The only class in the app: `getDerivedStateFromError` and `componentDidCatch` have no hook
 * equivalent, so a render-phase throw is unreachable from a function component.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { kind: 'ok' }
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { kind: 'caught', message: describeError(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The screen shows one line. The stack and the component trace that say *where* it broke
    // exist only here, and only if this hands them to the devtools log.
    console.error('Render failed', error, info.componentStack)
  }

  /**
   * Clearing the fallback re-renders the same tree, so it is only safe once the input that tree
   * reads has changed — a project that actually opened. After a cancelled picker the render
   * would throw again immediately and the reset would read as the button doing nothing.
   */
  async chooseProjectFolder(): Promise<void> {
    if (await connectToNewDirectory()) this.setState({ kind: 'ok' })
  }

  render(): ReactNode {
    if (this.state.kind === 'ok') return this.props.children
    return (
      <main className="error-boundary">
        <h1 className="error-boundary__title">Something broke</h1>
        <p className="error-boundary__lead">
          NPCanvas stopped rendering. Your project folder on disk is untouched — the last save is
          still there, and opening a folder again rebuilds the view from it.
        </p>
        <p className="error-boundary__message" role="status">
          {this.state.message}
        </p>
        <div className="error-boundary__actions">
          <button
            type="button"
            className="error-boundary__button"
            onClick={() => void this.chooseProjectFolder()}
          >
            Choose project folder
          </button>
          <button
            type="button"
            className="error-boundary__button error-boundary__button--quiet"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </main>
    )
  }
}

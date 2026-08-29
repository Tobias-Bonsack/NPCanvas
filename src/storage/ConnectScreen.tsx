import type { ReactElement, ReactNode } from 'react'
import { assertNever } from '../assert-never.ts'
import type { AppState } from '../project/types.ts'
import { connectToNewDirectory, grantSavedDirectoryAccess } from './project-directory.ts'
import './ConnectScreen.css'

/** Every state before a project exists. `ready` renders the app shell instead. */
type ConnectState = Exclude<AppState, { kind: 'ready' }>

/**
 * Exhaustive over `ConnectState` with no catch-all: the explicit `ReactElement` return type
 * is what turns a newly added pre-project state into a compile error here.
 */
export function ConnectScreen({ state }: { state: ConnectState }): ReactElement {
  switch (state.kind) {
    case 'unsupported':
      return (
        <Panel title="Unsupported browser">
          <p className="lead-text">
            NPCanvas keeps your project in a folder on disk using the File System Access API,
            which only Chromium-based browsers implement. Open this page in Chrome or Edge.
          </p>
          <p className="connect__note">
            There is deliberately no download/export fallback. Editing files in place is the
            whole storage model, and a download would give you a copy that silently drifts from
            the project folder instead.
          </p>
        </Panel>
      )

    case 'disconnected':
      return (
        <Panel title="NPCanvas">
          <p className="lead-text">
            Pick a project folder. NPCanvas reads and writes <code>data.json</code> and a{' '}
            <code>media/</code> subfolder inside it, and nothing outside it.
          </p>
          <button
            type="button"
            className="button--primary"
            onClick={() => void connectToNewDirectory()}
          >
            Choose project folder
          </button>
        </Panel>
      )

    case 'reconnecting':
      return (
        <Panel title="Reconnect">
          <p className="lead-text">
            NPCanvas remembers <strong>{state.directoryName}</strong>, but browsers drop folder
            access when the tab closes. Grant it again to pick up where you left off.
          </p>
          <button
            type="button"
            className="button--primary"
            onClick={() => void grantSavedDirectoryAccess()}
          >
            Reconnect to {state.directoryName}
          </button>
        </Panel>
      )

    case 'loading':
      return (
        <Panel title="Loading">
          {/* The whole panel is swapped per state, so the announcement has to ride on the text
              that appears: a folder opening is otherwise silent, and it can take a while. */}
          <p className="lead-text" role="status">
            Reading <strong>{state.directoryName}</strong>…
          </p>
        </Panel>
      )

    case 'load-failed':
      return (
        <Panel title="Could not open project">
          <p className="lead-text">
            <strong>{state.directoryName}</strong> could not be opened.
          </p>
          <p className="message-box" role="status">
            {state.message}
          </p>
          {/* The picker, and only the picker. A "Try again" here re-asked for a grant the user
              had just refused — and Chromium answers `denied` for a refused origin and folder
              without prompting, so that button could only ever fail again. Choosing the folder
              in the picker re-asks properly, and is equally the way out of an unreadable
              `data.json`. */}
          <button
            type="button"
            className="button--primary"
            onClick={() => void connectToNewDirectory()}
          >
            Choose project folder
          </button>
        </Panel>
      )

    default:
      return assertNever(state)
  }
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <main className="connect">
      <h1 className="fatal-title">{title}</h1>
      {children}
    </main>
  )
}

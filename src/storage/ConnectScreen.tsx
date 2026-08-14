import type { ReactElement, ReactNode } from 'react'
import { assertNever } from '../assert-never.ts'
import { createEmptyProject } from '../project/data-file.ts'
import { dispatch } from '../project/store.ts'
import type { AppState } from '../project/types.ts'
import { connectToNewDirectory, grantSavedDirectoryAccess } from './project-directory.ts'
import './ConnectScreen.css'

/** Every state before a project exists. `ready` renders the app shell instead. */
export type ConnectState = Exclude<AppState, { kind: 'ready' }>

/**
 * Exhaustive over `ConnectState` with no catch-all: the explicit `ReactElement` return type
 * is what turns a newly added pre-project state into a compile error here.
 */
export function ConnectScreen({ state }: { state: ConnectState }): ReactElement {
  switch (state.kind) {
    case 'unsupported':
      return (
        <Panel title="Unsupported browser">
          <p className="connect__lead">
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
          <p className="connect__lead">
            Pick a project folder. NPCanvas reads and writes <code>data.json</code> and a{' '}
            <code>media/</code> subfolder inside it, and nothing outside it.
          </p>
          <button
            type="button"
            className="connect__button"
            onClick={() => void connectToNewDirectory()}
          >
            Choose project folder
          </button>
          {/* Temporary: keeps `ready` reachable without a folder. Removed by #5. */}
          <button
            type="button"
            className="connect__dev-button"
            onClick={() => {
              dispatch({
                kind: 'project/loaded',
                directoryName: 'Demo',
                project: createEmptyProject('Demo'),
              })
            }}
          >
            Load an in-memory demo project (dev only)
          </button>
        </Panel>
      )

    case 'reconnecting':
      return (
        <Panel title="Reconnect">
          <p className="connect__lead">
            NPCanvas remembers <strong>{state.directoryName}</strong>, but browsers drop folder
            access when the tab closes. Grant it again to pick up where you left off.
          </p>
          <button
            type="button"
            className="connect__button"
            onClick={() => void grantSavedDirectoryAccess()}
          >
            Reconnect to {state.directoryName}
          </button>
        </Panel>
      )

    case 'loading':
      return (
        <Panel title="Loading">
          <p className="connect__lead">
            Reading <strong>{state.directoryName}</strong>…
          </p>
        </Panel>
      )

    case 'load-failed':
      return (
        <Panel title="Could not open project">
          <p className="connect__lead">
            <strong>{state.directoryName}</strong> could not be opened.
          </p>
          <p className="connect__error">{state.message}</p>
          <div className="connect__actions">
            <button
              type="button"
              className="connect__button"
              onClick={() => void grantSavedDirectoryAccess()}
            >
              Try again
            </button>
            <button
              type="button"
              className="connect__button connect__button--quiet"
              onClick={() => void connectToNewDirectory()}
            >
              Choose another folder
            </button>
          </div>
        </Panel>
      )

    default:
      return assertNever(state)
  }
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <main className="connect">
      <h1 className="connect__title">{title}</h1>
      {children}
    </main>
  )
}

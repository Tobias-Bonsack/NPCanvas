import type { ReactElement, ReactNode } from 'react'
import type { AppState } from '../project/types.ts'
import { createEmptyProject } from '../project/data-file.ts'
import { dispatch, useAppState } from '../project/store.ts'
import './App.css'

type ReadyState = Extract<AppState, { kind: 'ready' }>

/**
 * Exhaustive over `AppState`, with no catch-all branch: the explicit `ReactElement` return
 * type is what makes a newly added variant a compile error here.
 */
export default function App(): ReactElement {
  const state = useAppState()
  switch (state.kind) {
    case 'unsupported':
      return <UnsupportedScreen />
    case 'disconnected':
      return <DisconnectedScreen />
    case 'reconnecting':
      return <ReconnectingScreen directoryName={state.directoryName} />
    case 'loading':
      return <LoadingScreen directoryName={state.directoryName} />
    case 'load-failed':
      return <LoadFailedScreen directoryName={state.directoryName} message={state.message} />
    case 'ready':
      return <ReadyScreen state={state} />
  }
}

function Screen({ title, children }: { title: string; children?: ReactNode }): ReactElement {
  return (
    <main className="app">
      <h1 className="app__title">{title}</h1>
      {children}
    </main>
  )
}

function UnsupportedScreen(): ReactElement {
  return (
    <Screen title="Unsupported browser">
      <p className="app__lead">
        NPCanvas stores your project in a folder on disk using the File System Access API, which is
        only available in Chromium-based browsers. Open this page in Chrome or Edge.
      </p>
    </Screen>
  )
}

function DisconnectedScreen(): ReactElement {
  return (
    <Screen title="NPCanvas">
      <p className="app__lead">No project folder connected.</p>
      {/* Temporary: makes `ready` reachable before storage exists. Removed by #5. */}
      <button
        type="button"
        className="app__dev-button"
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
    </Screen>
  )
}

function ReconnectingScreen({ directoryName }: { directoryName: string }): ReactElement {
  return (
    <Screen title="Reconnecting">
      <p className="app__lead">
        Grant access to <strong>{directoryName}</strong> again to continue.
      </p>
    </Screen>
  )
}

function LoadingScreen({ directoryName }: { directoryName: string }): ReactElement {
  return (
    <Screen title="Loading">
      <p className="app__lead">
        Reading <strong>{directoryName}</strong>…
      </p>
    </Screen>
  )
}

function LoadFailedScreen({
  directoryName,
  message,
}: {
  directoryName: string
  message: string
}): ReactElement {
  return (
    <Screen title="Could not open project">
      <p className="app__lead">
        <strong>{directoryName}</strong> could not be read.
      </p>
      <p className="app__error">{message}</p>
    </Screen>
  )
}

function ReadyScreen({ state }: { state: ReadyState }): ReactElement {
  return (
    <Screen title={state.project.projectName}>
      <p className="app__lead">
        Connected to <strong>{state.directoryName}</strong>.
      </p>
    </Screen>
  )
}

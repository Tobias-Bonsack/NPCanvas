import type { ReactElement, ReactNode } from 'react'
import { ConnectScreen } from '../storage/ConnectScreen.tsx'
import type { AppState } from '../project/types.ts'
import { useAppState } from '../project/store.ts'
import { Nav } from './Nav.tsx'
import type { Route } from './route.ts'
import { useRoute } from './route.ts'
import './App.css'

type ReadyState = Extract<AppState, { kind: 'ready' }>

/** Everything before a project exists belongs to `ConnectScreen`, which is exhaustive over it. */
export default function App(): ReactElement {
  const state = useAppState()
  if (state.kind !== 'ready') return <ConnectScreen state={state} />
  return <ReadyScreen state={state} />
}

function Screen({ title, children }: { title: string; children?: ReactNode }): ReactElement {
  return (
    <main className="app">
      <h1 className="app__title">{title}</h1>
      {children}
    </main>
  )
}

function ReadyScreen({ state }: { state: ReadyState }): ReactElement {
  const route = useRoute()
  return (
    <div className="app-shell">
      <Nav />
      <ReadyView state={state} route={route} />
    </div>
  )
}

/** Exhaustive over `Route`; the `ReactElement` return type rejects a new view silently added. */
function ReadyView({ state, route }: { state: ReadyState; route: Route }): ReactElement {
  switch (route.kind) {
    case 'map':
      return (
        <Screen title={state.project.projectName}>
          <p className="app__lead">
            Connected to <strong>{state.directoryName}</strong>. Map canvas arrives in #9.
          </p>
        </Screen>
      )
    case 'quests':
      return (
        <Screen title="Quest board">
          <p className="app__lead">{state.project.quests.length} quests.</p>
        </Screen>
      )
    case 'insights':
      return (
        <Screen title="Insights">
          <p className="app__lead">{state.project.dialogues.length} dialogues logged.</p>
        </Screen>
      )
  }
}

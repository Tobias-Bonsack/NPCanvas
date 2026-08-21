import { useState } from 'react'
import type { ReactElement } from 'react'
import { InsightsScreen } from '../insights/InsightsScreen.tsx'
import { MapScreen } from '../map/MapScreen.tsx'
import { QuestBoard } from '../quest/QuestBoard.tsx'
import { ConnectScreen } from '../storage/ConnectScreen.tsx'
import type { AppState, ProjectRepairs, SaveState } from '../project/types.ts'
import { useAppStateExceptSave } from '../project/store.ts'
import { Nav } from './Nav.tsx'
import { RepairNotice } from './RepairNotice.tsx'
import { SaveFailureBanner } from './SaveFailureBanner.tsx'
import type { Route } from './route.ts'
import { useRoute } from './route.ts'
import './App.css'

type ReadyState = Extract<AppState, { kind: 'ready' }>

/** Everything before a project exists belongs to `ConnectScreen`, which is exhaustive over it. */
export default function App(): ReactElement {
  // Not `useAppState`: a save cycle is three states in under a second, and none of them change
  // anything below this line. `Nav` and the banner subscribe to `save` themselves.
  const state = useAppStateExceptSave()
  if (state.kind !== 'ready') return <ConnectScreen state={state} />
  return <ReadyScreen state={state} />
}

function ReadyScreen({ state }: { state: ReadyState }): ReactElement {
  const route = useRoute()
  // The dismissal is keyed to the failure object, not to a boolean, and the reducer builds a
  // new `failed` one per failed write. So a *later* failure reopens a banner the user closed,
  // while restating the same one does not — no effect, and nothing to reset on the way out.
  const [dismissed, setDismissed] = useState<SaveState | null>(null)
  // Same object-identity dismissal, for the same reason: `project/loaded` builds a fresh
  // `repairs` per load, so opening a second damaged folder reopens a notice closed for the
  // first one, while a re-render of this one does not.
  const [dismissedRepairs, setDismissedRepairs] = useState<ProjectRepairs | null>(null)
  const repairs =
    state.repairs.kind === 'repaired' && state.repairs !== dismissedRepairs ? state.repairs : null

  return (
    <div className="app-shell">
      <Nav directoryName={state.directoryName} onReviewSaveFailure={() => setDismissed(null)} />
      <SaveFailureBanner dismissed={dismissed} onDismiss={setDismissed} />
      {repairs !== null && (
        <RepairNotice repairs={repairs} onDismiss={() => setDismissedRepairs(repairs)} />
      )}
      <ReadyView state={state} route={route} />
    </div>
  )
}

/** Exhaustive over `Route`; the `ReactElement` return type rejects a new view silently added. */
function ReadyView({ state, route }: { state: ReadyState; route: Route }): ReactElement {
  switch (route.kind) {
    case 'canvas':
      return <MapScreen project={state.project} selection={state.selection} route={route} />

    case 'quests':
      return <QuestBoard project={state.project} route={route} />

    case 'insights':
      return <InsightsScreen project={state.project} />
  }
}

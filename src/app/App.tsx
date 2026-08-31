import { useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import { CinemaScreen } from '../cinema/CinemaScreen.tsx'
import { InsightsScreen } from '../insights/InsightsScreen.tsx'
import { MapScreen } from '../map/MapScreen.tsx'
import { QuestBoard } from '../quest/QuestBoard.tsx'
import { SettingsScreen } from '../settings/SettingsScreen.tsx'
import { ConnectScreen } from '../storage/ConnectScreen.tsx'
import type { AppState, ProjectRepairs, SaveState } from '../project/types.ts'
import { useAppStateExceptSave } from '../project/store.ts'
import { SearchPalette } from '../search/SearchPalette.tsx'
import { Nav } from './Nav.tsx'
import { RepairNotice } from './RepairNotice.tsx'
import { SaveFailureBanner } from './SaveFailureBanner.tsx'
import type { Route } from './route.ts'
import { navigate, useRoute } from './route.ts'
import type {
  CanvasViewState,
  CinemaViewState,
  InsightsViewState,
  QuestsViewState,
} from './view-state.ts'
import { INITIAL_VIEW_STATE } from './view-state.ts'
import './app.css'

type ReadyState = Extract<AppState, { kind: 'ready' }>

export default function App(): ReactElement {
  // Not useAppState — a save cycle is three states a second and changes nothing below this
  // line. Nav and the banner subscribe to `save` themselves.
  const state = useAppStateExceptSave()
  if (state.kind !== 'ready') return <ConnectScreen state={state} />
  return <ReadyScreen state={state} />
}

function ReadyScreen({ state }: { state: ReadyState }): ReactElement {
  const route = useRoute()
  // Keyed on the failure object, not a boolean — the reducer builds a fresh `failed` per write,
  // so a later failure reopens a dismissed banner while restating the same one does not.
  const [dismissed, setDismissed] = useState<SaveState | null>(null)
  // Same object-identity dismissal — project/loaded builds a fresh `repairs` per load.
  const [dismissedRepairs, setDismissedRepairs] = useState<ProjectRepairs | null>(null)
  const repairs =
    state.repairs.kind === 'repaired' && state.repairs !== dismissedRepairs ? state.repairs : null

  // Held one level above the route switch, so each view's transient state survives a switch
  // away and back — not store state, never touches data.json.
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE)
  const onCanvasStateChange = useCallback(
    (update: (prev: CanvasViewState) => CanvasViewState) =>
      setViewState((prev) => ({ ...prev, canvas: update(prev.canvas) })),
    [],
  )
  const onInsightsStateChange = useCallback(
    (insights: InsightsViewState) => setViewState((prev) => ({ ...prev, insights })),
    [],
  )
  const onQuestsStateChange = useCallback(
    (quests: QuestsViewState) => setViewState((prev) => ({ ...prev, quests })),
    [],
  )
  const onCinemaStateChange = useCallback(
    (cinema: CinemaViewState) => setViewState((prev) => ({ ...prev, cinema })),
    [],
  )
  // The search palette can't do this itself: opening an NPC's dossier needs both routing and
  // the view state that lives here.
  const onOpenNpcDossier = useCallback((key: string) => {
    setViewState((prev) => ({ ...prev, insights: { ...prev.insights, dossierKey: key } }))
    navigate({ kind: 'insights' })
  }, [])

  return (
    <div className="app-shell">
      <a className="skip-link visually-hidden" href="#main-content">
        Skip to main content
      </a>
      <Nav directoryName={state.directoryName} onReviewSaveFailure={() => setDismissed(null)} />
      <SaveFailureBanner dismissed={dismissed} onDismiss={setDismissed} />
      {repairs !== null && (
        <RepairNotice repairs={repairs} onDismiss={() => setDismissedRepairs(repairs)} />
      )}
      <main id="main-content" className="app-shell__main">
        <ReadyView
          state={state}
          route={route}
          viewState={viewState}
          onCanvasStateChange={onCanvasStateChange}
          onCinemaStateChange={onCinemaStateChange}
          onInsightsStateChange={onInsightsStateChange}
          onQuestsStateChange={onQuestsStateChange}
        />
      </main>
      <SearchPalette project={state.project} onOpenNpcDossier={onOpenNpcDossier} />
    </div>
  )
}

function ReadyView({
  state,
  route,
  viewState,
  onCanvasStateChange,
  onCinemaStateChange,
  onInsightsStateChange,
  onQuestsStateChange,
}: {
  state: ReadyState
  route: Route
  viewState: {
    canvas: CanvasViewState
    cinema: CinemaViewState
    insights: InsightsViewState
    quests: QuestsViewState
  }
  onCanvasStateChange: (update: (prev: CanvasViewState) => CanvasViewState) => void
  onCinemaStateChange: (cinema: CinemaViewState) => void
  onInsightsStateChange: (insights: InsightsViewState) => void
  onQuestsStateChange: (quests: QuestsViewState) => void
}): ReactElement {
  switch (route.kind) {
    case 'canvas':
      return (
        <MapScreen
          project={state.project}
          selection={state.selection}
          route={route}
          viewState={viewState.canvas}
          onViewStateChange={onCanvasStateChange}
        />
      )

    case 'cinema':
      return (
        <CinemaScreen
          project={state.project}
          route={route}
          viewState={viewState.cinema}
          onViewStateChange={onCinemaStateChange}
        />
      )

    case 'quests':
      return (
        <QuestBoard
          project={state.project}
          route={route}
          viewState={viewState.quests}
          onViewStateChange={onQuestsStateChange}
        />
      )

    case 'insights':
      return (
        <InsightsScreen
          project={state.project}
          viewState={viewState.insights}
          onViewStateChange={onInsightsStateChange}
        />
      )

    case 'settings':
      return <SettingsScreen project={state.project} />
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { CinemaViewState } from '../app/view-state.ts'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import type { ProjectFile } from '../project/types.ts'
import { MIN_PANEL_WIDTH } from '../dialogue/panel-width.ts'
import { usePanelResize } from '../dialogue/use-panel-resize.ts'
import { CinemaBand } from './CinemaBand.tsx'
import { CinemaLedger } from './CinemaLedger.tsx'
import { CinemaMinimap } from './CinemaMinimap.tsx'
import { CinemaQuestRail } from './CinemaQuestRail.tsx'
import { CinemaStage } from './CinemaStage.tsx'
import { isAnnounceableMove, SPEED_MAX, SPEED_MIN, SPEED_STEP } from './playhead.ts'
import type { Playhead, PlayheadAction } from './playhead.ts'
import { usePlayhead } from './use-playhead.ts'
import { questArcs } from './quest-arcs.ts'
import { buildReel } from './reel.ts'
import { journeyTally } from './tally.ts'
import './cinema.css'

export function CinemaScreen({
  project,
  route,
  viewState,
  onViewStateChange,
}: {
  project: ProjectFile
  route: Extract<Route, { kind: 'cinema' }>
  viewState: CinemaViewState
  onViewStateChange: (viewState: CinemaViewState) => void
}): ReactElement {
  const reel = buildReel(project)
  const arcs = questArcs(project.quests, reel)
  const lastIndex = Math.max(0, reel.moments.length - 1)
  const initialMoment = Math.min(Math.max(viewState.playheadIndex, 0), lastIndex)
  const [playhead, rawDispatch] = usePlayhead(reel, initialMoment)

  // `dispatch` calls from `tick` (inside usePlayhead) never pass through here, so the live
  // region below sees only the deliberate moves this screen and the stage originate.
  const [announcement, setAnnouncement] = useState('')
  const lastAction = useRef<PlayheadAction | null>(null)
  function dispatch(action: PlayheadAction): void {
    lastAction.current = action
    rawDispatch(action)
  }

  // `at` is a one-shot intent (see route.ts): seek the playhead once, then clear it so the
  // address bar never accumulates a position for the back button to step through.
  const at = route.at
  useEffect(() => {
    if (at === null) return
    const moment = reel.moments.find((candidate) => candidate.dialogue.id === at)
    if (moment !== undefined) rawDispatch({ kind: 'seek', moment: moment.index })
    navigate({ kind: 'cinema', at: null }, { replace: true })
  }, [at, reel, rawDispatch])

  // Mirrored into the view state that survives a switch away and back — see view-state.ts.
  // `onViewStateChange` replaces the whole object, so every setter here spreads `viewState`
  // rather than sending just the field it changed.
  // Read through a ref rather than closing over `viewState` directly — a width drag also goes
  // through `onViewStateChange`, and putting `viewState` in this effect's deps would re-fire it
  // on every drag frame for a field (`playheadIndex`) that hasn't actually moved.
  const viewStateRef = useRef(viewState)
  viewStateRef.current = viewState
  useEffect(() => {
    onViewStateChange({ ...viewStateRef.current, playheadIndex: playhead.moment })
  }, [playhead.moment, onViewStateChange])

  // Both rails resize independently, each clamped against the body's width minus the *other*
  // rail's current rendered width — the same floor `clampPanelWidth` gives the canvas's own
  // side panel, applied twice since Cinema keeps two columns open at once.
  const bodyRef = useRef<HTMLDivElement>(null)
  const questRailRef = useRef<HTMLElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const measureQuestRailAvailableWidth = useCallback(() => {
    const railWidth = railRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH
    return (bodyRef.current?.clientWidth ?? 0) - railWidth
  }, [])
  const measureRailAvailableWidth = useCallback(() => {
    const questRailWidth = questRailRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH
    return (bodyRef.current?.clientWidth ?? 0) - questRailWidth
  }, [])
  const setQuestRailWidth = useCallback(
    (questRailWidth: number) => onViewStateChange({ ...viewState, questRailWidth }),
    [viewState, onViewStateChange],
  )
  const setRailWidth = useCallback(
    (railWidth: number) => onViewStateChange({ ...viewState, railWidth }),
    [viewState, onViewStateChange],
  )
  const questRailResize = usePanelResize(
    questRailRef,
    setQuestRailWidth,
    measureQuestRailAvailableWidth,
    'left',
  )
  const railResize = usePanelResize(railRef, setRailWidth, measureRailAvailableWidth, 'right')

  useEffect(() => {
    const action = lastAction.current
    lastAction.current = null
    if (action === null || !isAnnounceableMove(action) || reel.moments.length === 0) return
    const current = reel.moments[playhead.moment]
    const state = playhead.playing ? 'Playing' : 'Paused'
    setAnnouncement(`${state}. Line ${playhead.moment + 1} of ${reel.moments.length}: ${current.dialogue.npcName}.`)
  }, [playhead.moment, playhead.frame, playhead.playing, reel])

  if (reel.moments.length === 0) {
    return (
      <section className="cinema">
        <h1 className="screen-title">Cinema</h1>
        <p className="cinema__empty hint-text">
          Nothing to play yet. Cinema plays back dialogue in the order it was spoken, and no
          logged line has a time attached.
        </p>
      </section>
    )
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    // A rail's own resize handle owns arrow keys while focused (`stepResize`) — letting them
    // also fall through to playhead transport would resize and seek in the same keystroke.
    if ((event.target as HTMLElement).getAttribute('role') === 'separator') return
    switch (event.key) {
      case ' ':
        event.preventDefault()
        dispatch(playhead.playing ? { kind: 'pause' } : { kind: 'play' })
        return
      case 'ArrowLeft':
        event.preventDefault()
        dispatch({ kind: 'step', by: -1 })
        return
      case 'ArrowRight':
        event.preventDefault()
        dispatch({ kind: 'step', by: 1 })
        return
      case ',':
        dispatch({ kind: 'frame', by: -1 })
        return
      case '.':
        dispatch({ kind: 'frame', by: 1 })
        return
      case 'Home':
        dispatch({ kind: 'jump', to: 'start' })
        return
      case 'End':
        dispatch({ kind: 'jump', to: 'end' })
        return
      case '[':
        dispatch({ kind: 'jump', to: 'session-prev' })
        return
      case ']':
        dispatch({ kind: 'jump', to: 'session-next' })
        return
      case '1':
      case '2':
      case '3':
      case '4': {
        const speed = [0.5, 1, 2, 4][Number(event.key) - 1]
        if (speed !== undefined) dispatch({ kind: 'speed', speed })
        return
      }
      default:
        return
    }
  }

  const moment = reel.moments[playhead.moment]
  const tallies = journeyTally(reel, project.relevanceTags)

  return (
    <section className="cinema" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="cinema__body" ref={bodyRef}>
        <aside
          ref={questRailRef}
          className="cinema__quest-rail card"
          style={
            viewState.questRailWidth === null
              ? undefined
              : { width: `${viewState.questRailWidth}px` }
          }
        >
          <CinemaQuestRail arcs={arcs} reel={reel} momentIndex={playhead.moment} />
          <div
            className="side-panel__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Quest rail width"
            aria-valuenow={Math.round(questRailResize.band?.width ?? MIN_PANEL_WIDTH)}
            aria-valuemin={MIN_PANEL_WIDTH}
            aria-valuemax={Math.round(questRailResize.band?.max ?? MIN_PANEL_WIDTH)}
            tabIndex={0}
            data-resizing={questRailResize.resizing ? 'true' : undefined}
            onPointerDown={questRailResize.beginResize}
            onPointerMove={questRailResize.moveResize}
            onPointerUp={questRailResize.endResize}
            onPointerCancel={questRailResize.cancelResize}
            onKeyDown={questRailResize.stepResize}
          />
        </aside>
        <div className="cinema__main">
          <div className="cinema__stage card">
            <CinemaStage
              moment={moment}
              frame={playhead.frame}
              project={project}
              announcement={announcement}
              onSeekFrame={(frame) => dispatch({ kind: 'frame-seek', frame })}
            />
          </div>
          <div className="cinema__band card">
            <CinemaBand
              project={project}
              reel={reel}
              moment={moment}
              onSeekMoment={(index) => dispatch({ kind: 'seek', moment: index })}
            />
          </div>
          <Transport playhead={playhead} dispatch={dispatch} />
        </div>
        <aside
          ref={railRef}
          className="cinema__rail card"
          style={
            viewState.railWidth === null ? undefined : { width: `${viewState.railWidth}px` }
          }
        >
          <div
            className="side-panel__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Right rail width"
            aria-valuenow={Math.round(railResize.band?.width ?? MIN_PANEL_WIDTH)}
            aria-valuemin={MIN_PANEL_WIDTH}
            aria-valuemax={Math.round(railResize.band?.max ?? MIN_PANEL_WIDTH)}
            tabIndex={0}
            data-resizing={railResize.resizing ? 'true' : undefined}
            onPointerDown={railResize.beginResize}
            onPointerMove={railResize.moveResize}
            onPointerUp={railResize.endResize}
            onPointerCancel={railResize.cancelResize}
            onKeyDown={railResize.stepResize}
          />
          <CinemaLedger project={project} tallies={tallies} moment={moment} />
          <div aria-hidden="true">
            <CinemaMinimap project={project} reel={reel} momentIndex={playhead.moment} />
          </div>
        </aside>
      </div>
    </section>
  )
}

function Transport({
  playhead,
  dispatch,
}: {
  playhead: Playhead
  dispatch: (action: PlayheadAction) => void
}): ReactElement {
  return (
    <div className="cinema__transport card">
      <button type="button" className="button" onClick={() => dispatch({ kind: 'jump', to: 'start' })}>
        ⏮
      </button>
      <button type="button" className="button" onClick={() => dispatch({ kind: 'step', by: -1 })}>
        ◀
      </button>
      <button
        type="button"
        className="button"
        aria-label={playhead.playing ? 'Pause' : 'Play'}
        onClick={() => dispatch(playhead.playing ? { kind: 'pause' } : { kind: 'play' })}
      >
        {playhead.playing ? '⏸' : '▶'}
      </button>
      <button type="button" className="button" onClick={() => dispatch({ kind: 'step', by: 1 })}>
        ▶
      </button>
      <button type="button" className="button" onClick={() => dispatch({ kind: 'jump', to: 'end' })}>
        ⏭
      </button>
      <label className="cinema__speed">
        <span className="cinema__speed-value">×{playhead.speed.toFixed(2)}</span>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={playhead.speed}
          aria-label="Playback speed"
          onChange={(event) => dispatch({ kind: 'speed', speed: Number(event.target.value) })}
        />
      </label>
    </div>
  )
}

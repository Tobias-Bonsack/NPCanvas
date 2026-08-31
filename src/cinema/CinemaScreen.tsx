import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { CinemaViewState } from '../app/view-state.ts'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import type { ProjectFile } from '../project/types.ts'
import { CinemaBand } from './CinemaBand.tsx'
import { CinemaStage } from './CinemaStage.tsx'
import { isAnnounceableMove, PLAY_SPEEDS } from './playhead.ts'
import type { Playhead, PlayheadAction } from './playhead.ts'
import { usePlayhead } from './use-playhead.ts'
import { questArcs } from './quest-arcs.ts'
import { buildReel } from './reel.ts'
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
  useEffect(() => {
    onViewStateChange({ playheadIndex: playhead.moment })
  }, [playhead.moment, onViewStateChange])

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
        <header className="cinema__bar">
          <h1 className="screen-title">Cinema</h1>
        </header>
        <p className="cinema__empty hint-text">
          Nothing to play yet. Cinema plays back dialogue in the order it was spoken, and no
          logged line has a time attached.
        </p>
      </section>
    )
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
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
        const speed = PLAY_SPEEDS[Number(event.key) - 1]
        if (speed !== undefined) dispatch({ kind: 'speed', speed })
        return
      }
      default:
        return
    }
  }

  const moment = reel.moments[playhead.moment]
  const frameCount = Math.max(1, moment.dialogue.media.length)

  return (
    <section className="cinema" tabIndex={0} onKeyDown={onKeyDown}>
      <header className="cinema__bar">
        <h1 className="screen-title">Cinema</h1>
        <p className="cinema__position hint-text">
          Line {playhead.moment + 1} of {reel.moments.length}
          {frameCount > 1 && ` — frame ${playhead.frame + 1} of ${frameCount}`}
        </p>
      </header>
      <div className="cinema__body">
        <div className="cinema__main">
          <div className="cinema__stage card">
            <CinemaStage
              moment={moment}
              frame={playhead.frame}
              project={project}
              reel={reel}
              arcs={arcs}
              announcement={announcement}
              onSeekMoment={(index) => dispatch({ kind: 'seek', moment: index })}
              onSeekFrame={(frame) => dispatch({ kind: 'frame-seek', frame })}
            />
          </div>
          <Transport playhead={playhead} dispatch={dispatch} />
          <div className="cinema__band card">
            <CinemaBand
              project={project}
              reel={reel}
              moment={moment}
              onSeekMoment={(index) => dispatch({ kind: 'seek', moment: index })}
            />
          </div>
        </div>
        <aside className="cinema__rail card" aria-hidden="true" />
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
        onClick={() => dispatch(playhead.playing ? { kind: 'pause' } : { kind: 'play' })}
      >
        {playhead.playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" className="button" onClick={() => dispatch({ kind: 'step', by: 1 })}>
        ▶
      </button>
      <button type="button" className="button" onClick={() => dispatch({ kind: 'jump', to: 'end' })}>
        ⏭
      </button>
      <div className="cinema__speeds" role="group" aria-label="Playback speed">
        {PLAY_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            className="button"
            aria-pressed={playhead.speed === speed}
            onClick={() => dispatch({ kind: 'speed', speed })}
          >
            ×{speed}
          </button>
        ))}
      </div>
    </div>
  )
}

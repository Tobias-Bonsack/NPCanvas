import { useEffect } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { CinemaViewState } from '../app/view-state.ts'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import { byId } from '../project/derived.ts'
import type { ProjectFile } from '../project/types.ts'
import { MediaView } from '../media/MediaView.tsx'
import { PLAY_SPEEDS } from './playhead.ts'
import type { Playhead, PlayheadAction } from './playhead.ts'
import { usePlayhead } from './use-playhead.ts'
import type { Moment } from './reel.ts'
import { buildReel } from './reel.ts'
import './cinema.css'

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

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
  const zonesById = byId(project.zones)
  const lastIndex = Math.max(0, reel.moments.length - 1)
  const initialMoment = Math.min(Math.max(viewState.playheadIndex, 0), lastIndex)
  const [playhead, dispatch] = usePlayhead(reel, initialMoment)

  // `at` is a one-shot intent (see route.ts): seek the playhead once, then clear it so the
  // address bar never accumulates a position for the back button to step through.
  const at = route.at
  useEffect(() => {
    if (at === null) return
    const moment = reel.moments.find((candidate) => candidate.dialogue.id === at)
    if (moment !== undefined) dispatch({ kind: 'seek', moment: moment.index })
    navigate({ kind: 'cinema', at: null }, { replace: true })
  }, [at, reel, dispatch])

  // Mirrored into the view state that survives a switch away and back — see view-state.ts.
  useEffect(() => {
    onViewStateChange({ playheadIndex: playhead.moment })
  }, [playhead.moment, onViewStateChange])

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
        dispatch({ kind: 'toggle' })
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
  const zoneName = moment.zoneId === null ? null : (zonesById.get(moment.zoneId)?.name ?? null)
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
            <StageMoment moment={moment} frame={playhead.frame} zoneName={zoneName} />
          </div>
          <Transport playhead={playhead} dispatch={dispatch} />
          <div className="cinema__band card" aria-hidden="true" />
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
      <button type="button" className="button" onClick={() => dispatch({ kind: 'toggle' })}>
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

function StageMoment({
  moment,
  frame,
  zoneName,
}: {
  moment: Moment
  frame: number
  zoneName: string | null
}): ReactElement {
  const { dialogue } = moment
  const media = dialogue.media[frame] ?? dialogue.media[0]
  return (
    <div className="cinema__moment">
      <p className="cinema__moment-meta micro-label">
        {dialogue.npcName}
        {zoneName !== null && ` — ${zoneName}`} — {TIME_FORMAT.format(new Date(dialogue.spokenAt))}
      </p>
      {dialogue.text !== '' && <p className="cinema__moment-text">{dialogue.text}</p>}
      {media !== undefined && (
        <div className="cinema__moment-media">
          <MediaView media={media} label={dialogue.npcName} fit="fill" />
        </div>
      )}
    </div>
  )
}

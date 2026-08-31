import { useEffect } from 'react'
import type { ReactElement } from 'react'
import type { CinemaViewState } from '../app/view-state.ts'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import { byId } from '../project/derived.ts'
import type { ProjectFile } from '../project/types.ts'
import { MediaView } from '../media/MediaView.tsx'
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

  // `at` is a one-shot intent (see route.ts): seek the playhead once, then clear it so the
  // address bar never accumulates a position for the back button to step through.
  const at = route.at
  useEffect(() => {
    if (at === null) return
    const moment = reel.moments.find((candidate) => candidate.dialogue.id === at)
    if (moment !== undefined) onViewStateChange({ playheadIndex: moment.index })
    navigate({ kind: 'cinema', at: null }, { replace: true })
  }, [at, reel, onViewStateChange])

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

  const lastIndex = reel.moments.length - 1
  const playheadIndex = Math.min(Math.max(viewState.playheadIndex, 0), lastIndex)
  const moment = reel.moments[playheadIndex]
  const zoneName = moment.zoneId === null ? null : (zonesById.get(moment.zoneId)?.name ?? null)

  return (
    <section className="cinema">
      <header className="cinema__bar">
        <h1 className="screen-title">Cinema</h1>
        <p className="cinema__position hint-text">
          Line {playheadIndex + 1} of {reel.moments.length}
        </p>
      </header>
      <div className="cinema__body">
        <div className="cinema__main">
          <div className="cinema__stage card">
            <StageMoment moment={moment} zoneName={zoneName} />
          </div>
          <div className="cinema__band card" aria-hidden="true" />
        </div>
        <aside className="cinema__rail card" aria-hidden="true" />
      </div>
    </section>
  )
}

function StageMoment({
  moment,
  zoneName,
}: {
  moment: Moment
  zoneName: string | null
}): ReactElement {
  const { dialogue } = moment
  return (
    <div className="cinema__moment">
      <p className="cinema__moment-meta micro-label">
        {dialogue.npcName}
        {zoneName !== null && ` — ${zoneName}`} — {TIME_FORMAT.format(new Date(dialogue.spokenAt))}
      </p>
      {dialogue.text !== '' && <p className="cinema__moment-text">{dialogue.text}</p>}
      {dialogue.media.length > 0 && (
        <div className="cinema__moment-media">
          <MediaView media={dialogue.media[0]} label={dialogue.npcName} fit="fill" />
        </div>
      )}
    </div>
  )
}

import type { ReactElement } from 'react'
import { segmentColor, segmentKeys, segmentLabel } from '../insights/relevance-segments.ts'
import type { ProjectFile, RelevanceTagId } from '../project/types.ts'
import type { Moment } from './reel.ts'
import type { JourneySoFar } from './tally.ts'
import { journeyAt } from './tally.ts'

function formatPlayedMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`
}

/** A running total beneath the minimap, reconstructed at the playhead — see CLAUDE.md § "Cinema"
 * and #162. Read-only, like the rest of Cinema: it reports `tallies`, it dispatches nothing. */
export function CinemaLedger({
  project,
  tallies,
  moment,
}: {
  project: ProjectFile
  tallies: readonly JourneySoFar[]
  moment: Moment
}): ReactElement | null {
  const current = journeyAt(tallies, moment.index)
  const final = tallies[tallies.length - 1]
  if (current === undefined || final === undefined) return null

  const keys = segmentKeys(project.relevanceTags)
  const labels = segmentLabel(project.relevanceTags)
  const colors = segmentColor(project.relevanceTags)
  const currentTags = new Set<RelevanceTagId>(moment.dialogue.relevance)

  return (
    <div className="cinema-ledger">
      <dl className="cinema-ledger__stats">
        <div className="cinema-ledger__stat">
          <dt>Lines</dt>
          <dd>{current.moments}</dd>
        </div>
        <div className="cinema-ledger__stat">
          <dt>Frames</dt>
          <dd>{current.frames}</dd>
        </div>
        <div className="cinema-ledger__stat">
          <dt>Zones visited</dt>
          <dd>
            {current.zonesVisited.size} of {project.zones.length}
          </dd>
        </div>
        <div className="cinema-ledger__stat">
          <dt>NPCs met</dt>
          <dd>{current.npcsMet.size}</dd>
        </div>
        <div className="cinema-ledger__stat">
          <dt>Played</dt>
          <dd>{formatPlayedMs(current.playedMs)}</dd>
        </div>
      </dl>
      <ul className="cinema-ledger__tags">
        {keys.map((segment) => {
          const count = current.segments.counts.get(segment) ?? 0
          const finalCount = final.segments.counts.get(segment) ?? 0
          const isCurrent = segment === 'untagged' ? currentTags.size === 0 : currentTags.has(segment)
          const justSeen = current.firstSeen.get(segment) === moment.index
          return (
            <li
              key={segment}
              className="cinema-ledger__tag"
              data-zero={count === 0 ? '' : undefined}
              data-current={isCurrent ? '' : undefined}
              data-just-seen={justSeen ? '' : undefined}
            >
              <span className="cinema-ledger__tag-swatch" style={{ background: colors.get(segment) }} />
              <span className="cinema-ledger__tag-label">{labels.get(segment) ?? ''}</span>
              <span className="cinema-ledger__tag-count">{count}</span>
              <span className="cinema-ledger__tag-bar">
                <span
                  className="cinema-ledger__tag-fill"
                  style={{
                    width: `${finalCount === 0 ? 0 : (count / finalCount) * 100}%`,
                    background: colors.get(segment),
                  }}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

import type { ReactElement } from 'react'
import { segmentColor, segmentKeys, segmentLabel, totalOf } from '../insights/relevance-segments.ts'
import type { ProjectFile, RelevanceTagId } from '../project/types.ts'
import type { Moment } from './reel.ts'
import type { JourneySoFar } from './tally.ts'
import { journeyAt } from './tally.ts'

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
  if (current === undefined) return null

  const keys = segmentKeys(project.relevanceTags)
  const labels = segmentLabel(project.relevanceTags)
  const colors = segmentColor(project.relevanceTags)
  const currentTags = new Set<RelevanceTagId>(moment.dialogue.relevance)
  const currentTotal = totalOf(current.segments.counts)

  return (
    <div className="cinema-ledger">
      <dl className="cinema-ledger__stats">
        <div className="cinema-ledger__stat">
          <dt>Lines</dt>
          <dd>{current.moments}</dd>
        </div>
        <div className="cinema-ledger__stat">
          <dt>NPCs met</dt>
          <dd>{current.npcsMet.size}</dd>
        </div>
      </dl>
      <ul className="cinema-ledger__tags">
        {keys.map((segment) => {
          const count = current.segments.counts.get(segment) ?? 0
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
                    width: `${currentTotal === 0 ? 0 : (count / currentTotal) * 100}%`,
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

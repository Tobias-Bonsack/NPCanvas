import type { CSSProperties, ReactElement } from 'react'
import { segmentColor, segmentKeys, segmentLabel, totalOf } from '../insights/relevance-segments.ts'
import type { ProjectFile, RelevanceTagId } from '../project/types.ts'
import type { Moment } from './reel.ts'
import type { JourneySoFar } from './tally.ts'
import { journeyAt } from './tally.ts'

// One property for swatch, bar fill and the pulse ring alike — same intersection-type trick as
// questHueStyle, since CSSProperties has no index signature for `--*`.
function segmentColorStyle(color: string): CSSProperties & Record<'--segment-color', string> {
  return { '--segment-color': color }
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
          <dt>All dialogue</dt>
          <dd>{current.moments}</dd>
        </div>
        <div className="cinema-ledger__stat">
          <dt>Unique NPCs</dt>
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
              // Same reason as CinemaQuestRail's key: two consecutive lines carrying this tag
              // would leave `data-current` standing, and the pulse would never restart.
              key={isCurrent ? `${segment}:${moment.index}` : segment}
              className="cinema-ledger__tag"
              data-zero={count === 0 ? '' : undefined}
              data-current={isCurrent ? '' : undefined}
              data-just-seen={justSeen ? '' : undefined}
              style={segmentColorStyle(colors.get(segment) ?? 'transparent')}
            >
              <span className="cinema-ledger__tag-swatch" />
              <span className="cinema-ledger__tag-label">{labels.get(segment) ?? ''}</span>
              <span className="cinema-ledger__tag-count">{count}</span>
              <span className="cinema-ledger__tag-bar">
                <span
                  className="cinema-ledger__tag-fill"
                  style={{ width: `${currentTotal === 0 ? 0 : (count / currentTotal) * 100}%` }}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

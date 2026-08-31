import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { dialogueSnippet } from '../dialogue-row/dialogue-summary.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import type { Quest } from '../project/types.ts'
import type { BandSlot } from './band-layout.ts'
import type { ArcState, QuestArc } from './quest-arcs.ts'
import { arcProgressAt, arcStateAt } from './quest-arcs.ts'
import type { Reel } from './reel.ts'

const ROW_HEIGHT = 22
const BAR_HEIGHT = 8
const BAR_Y = (ROW_HEIGHT - BAR_HEIGHT) / 2
const MARK_WIDTH = 2
const MARK_HEIGHT = BAR_HEIGHT + 4
const MARK_Y = (ROW_HEIGHT - MARK_HEIGHT) / 2

function activateOnKey(event: ReactKeyboardEvent, onActivate: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  onActivate()
}

function questName(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}

function rowLabel(arc: QuestArc, state: ArcState, momentIndex: number): string {
  const name = questName(arc.quest)
  if (state === 'unseen') return `${name} — not yet started`
  if (state === 'done') return `${name} — done`
  const { reached, total } = arcProgressAt(arc, momentIndex)
  return `${name} — open, ${reached} of ${total}`
}

/** One row per quest, hung beneath the band on its axis — see CLAUDE.md § "Cinema" and #160. */
export function CinemaQuestBars({
  arcs,
  slots,
  width,
  reel,
  momentIndex,
  onSeekMoment,
}: {
  arcs: readonly QuestArc[]
  slots: readonly BandSlot[]
  width: number
  reel: Reel
  momentIndex: number
  onSeekMoment: (index: number) => void
}): ReactElement | null {
  if (arcs.length === 0) return null

  const height = arcs.length * ROW_HEIGHT

  return (
    <svg
      className="cinema-quest-bars"
      viewBox={`0 0 ${width} ${height}`}
      role="list"
      aria-label="Quests"
    >
      {arcs.map((arc, rowIndex) => {
        const startSlot = slots[arc.firstMoment]
        const endSlot = slots[arc.lastMoment]
        if (startSlot === undefined || endSlot === undefined) return null

        const y = rowIndex * ROW_HEIGHT
        const barLeft = startSlot.x
        const barRight = endSlot.x + endSlot.width
        const state = arcStateAt(arc, momentIndex)
        const label = rowLabel(arc, state, momentIndex)

        const currentSlot = slots[Math.min(Math.max(momentIndex, 0), slots.length - 1)]
        const fillRight =
          currentSlot === undefined
            ? barLeft
            : Math.min(Math.max(currentSlot.x + currentSlot.width, barLeft), barRight)

        // Flips to the bar's own left edge once the right margin runs out — a status label must
        // stay inside the viewBox, which clips (SVG's default overflow) rather than wrapping.
        const roomOnRight = width - barRight >= 44
        const statusX = roomOnRight ? barRight + 6 : barLeft - 6
        const statusAnchor = roomOnRight ? 'start' : 'end'

        return (
          <g key={arc.quest.id} className="cinema-quest-bars__row" data-state={state} style={questAccentStyle(arc.quest)}>
            <g
              role="button"
              tabIndex={0}
              aria-label={label}
              className="cinema-quest-bars__bar"
              onClick={() => onSeekMoment(arc.firstMoment)}
              onKeyDown={(event) => activateOnKey(event, () => onSeekMoment(arc.firstMoment))}
            >
              <rect
                className="cinema-quest-bars__track"
                x={barLeft}
                y={y + BAR_Y}
                width={Math.max(barRight - barLeft, 1)}
                height={BAR_HEIGHT}
              />
              {state !== 'unseen' && (
                <rect
                  className="cinema-quest-bars__fill"
                  x={barLeft}
                  y={y + BAR_Y}
                  width={Math.max(fillRight - barLeft, 0)}
                  height={BAR_HEIGHT}
                />
              )}
              {state === 'done' && (
                <text
                  className="cinema-quest-bars__seal"
                  x={statusX}
                  y={y + ROW_HEIGHT / 2 + 3}
                  textAnchor={statusAnchor}
                >
                  ✓
                </text>
              )}
              {state === 'open' && (
                <text
                  className="cinema-quest-bars__progress"
                  x={statusX}
                  y={y + ROW_HEIGHT / 2 + 3}
                  textAnchor={statusAnchor}
                >
                  {arcProgressAt(arc, momentIndex).reached} of {arcProgressAt(arc, momentIndex).total}
                </text>
              )}
            </g>

            {arc.moments.map((markIndex) => {
              const markSlot = slots[markIndex]
              if (markSlot === undefined) return null
              const markX = markSlot.x + markSlot.width / 2
              const markDialogue = reel.moments[markIndex]?.dialogue
              const markLabel =
                markDialogue === undefined ? 'Seek to line' : `${markDialogue.npcName}: ${dialogueSnippet(markDialogue)}`
              const onMarkClick = (event: ReactMouseEvent): void => {
                event.stopPropagation()
                onSeekMoment(markIndex)
              }

              return (
                <g
                  key={markIndex}
                  role="button"
                  tabIndex={0}
                  aria-label={markLabel}
                  className="cinema-quest-bars__mark"
                  onClick={onMarkClick}
                  onKeyDown={(event) => activateOnKey(event, () => onSeekMoment(markIndex))}
                >
                  <rect x={markX - MARK_WIDTH / 2} y={y + MARK_Y} width={MARK_WIDTH} height={MARK_HEIGHT} />
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

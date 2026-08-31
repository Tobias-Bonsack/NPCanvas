import type { ReactElement } from 'react'
import type { Quest } from '../project/types.ts'
import { QUEST_DONE_HUE, questHueStyle } from '../quest/quest-style.ts'
import type { Reel } from './reel.ts'
import type { ArcState, QuestArc } from './quest-arcs.ts'
import { arcStateAt } from './quest-arcs.ts'

function questName(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}

// Green only once the reel has actually reached the quest's last line — `quest.status` set to
// 'done' from outside the reel must not paint a quest green before its close plays out here.
function railHueStyle(state: ArcState, quest: Quest) {
  return questHueStyle(state === 'done' ? QUEST_DONE_HUE : quest.hue)
}

// `arc.moments` is ascending and every entry is <= a moment the playhead has already reached
// (arcs with state 'unseen' are filtered out before this runs), so the last one at or before
// `momentIndex` is the most recent line spoken for this quest.
function latestSpeakerAt(arc: QuestArc, reel: Reel, momentIndex: number): string | null {
  const reached = arc.moments.filter((index) => index <= momentIndex)
  const latest = reached[reached.length - 1]
  return latest === undefined ? null : reel.moments[latest].dialogue.npcName
}

/** Every quest already underway at the playhead — see CLAUDE.md § "Cinema". */
export function CinemaQuestRail({
  arcs,
  reel,
  momentIndex,
}: {
  arcs: readonly QuestArc[]
  reel: Reel
  momentIndex: number
}): ReactElement {
  const active = arcs
    .map((arc) => ({ arc, state: arcStateAt(arc, momentIndex) }))
    .filter(({ state }) => state !== 'unseen')
    // Done quests sink to the bottom; otherwise the reel's own arrival order (arcs is sorted by
    // firstMoment) is kept — a stable sort only ever moves the 'done' items.
    .sort((a, b) => Number(a.state === 'done') - Number(b.state === 'done'))

  return (
    <>
      <p className="micro-label">Quests</p>
      {active.length === 0 ? (
        <p className="hint-text cinema-quest-rail__empty">No quests yet.</p>
      ) : (
        <ul className="cinema-quest-rail__list" aria-label="Active quests">
          {active.map(({ arc, state }) => {
            const speaker = latestSpeakerAt(arc, reel, momentIndex)
            return (
              <li
                key={arc.quest.id}
                className="cinema-quest-rail__item"
                data-state={state}
                style={railHueStyle(state, arc.quest)}
              >
                <p className="cinema-quest-rail__name">{questName(arc.quest)}</p>
                {speaker !== null && <p className="cinema-quest-rail__speaker">Zuletzt: {speaker}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

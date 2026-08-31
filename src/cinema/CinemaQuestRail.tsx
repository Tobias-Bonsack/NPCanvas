import type { ReactElement } from 'react'
import type { Quest } from '../project/types.ts'
import { QUEST_DONE_HUE, questHueStyle } from '../quest/quest-style.ts'
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

/** Every quest already underway at the playhead, name only — see CLAUDE.md § "Cinema". */
export function CinemaQuestRail({
  arcs,
  momentIndex,
}: {
  arcs: readonly QuestArc[]
  momentIndex: number
}): ReactElement {
  const active = arcs
    .map((arc) => ({ arc, state: arcStateAt(arc, momentIndex) }))
    .filter(({ state }) => state !== 'unseen')

  return (
    <>
      <p className="micro-label">Quests</p>
      {active.length === 0 ? (
        <p className="hint-text cinema-quest-rail__empty">No quests yet.</p>
      ) : (
        <ul className="cinema-quest-rail__list" aria-label="Active quests">
          {active.map(({ arc, state }) => (
            <li
              key={arc.quest.id}
              className="cinema-quest-rail__item"
              data-state={state}
              style={railHueStyle(state, arc.quest)}
            >
              {questName(arc.quest)}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

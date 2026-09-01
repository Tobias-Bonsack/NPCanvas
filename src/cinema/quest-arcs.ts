import type { Quest } from '../project/types.ts'
import type { Reel } from './reel.ts'

export const ARC_STATES = ['unseen', 'open', 'done'] as const
export type ArcState = (typeof ARC_STATES)[number]

export const ARC_EVENTS = ['started', 'closed', 'last-line'] as const
export type ArcEvent = (typeof ARC_EVENTS)[number]

/** One quest's span over the reel's ordinal axis — see CLAUDE.md § "Cinema". */
export type QuestArc = {
  quest: Quest
  firstMoment: number
  lastMoment: number
  /** `Moment.index` values, ascending, so #160 draws its marks without a second lookup. */
  moments: readonly number[]
}

export function questArcs(quests: readonly Quest[], reel: Reel): QuestArc[] {
  const indexByDialogueId = new Map(reel.moments.map((moment) => [moment.dialogue.id, moment.index]))

  const arcs: QuestArc[] = []
  for (const quest of quests) {
    const moments = quest.dialogueIds
      .map((id) => indexByDialogueId.get(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b)
    if (moments.length === 0) continue

    arcs.push({ quest, firstMoment: moments[0], lastMoment: moments[moments.length - 1], moments })
  }

  return arcs.sort((a, b) => a.firstMoment - b.firstMoment)
}

export function arcStateAt(arc: QuestArc, index: number): ArcState {
  if (index < arc.firstMoment) return 'unseen'
  if (index >= arc.lastMoment && arc.quest.status === 'done') return 'done'
  return 'open'
}

// 'closed' outranks 'started' for the one-line quest that both opens and finishes at the same
// moment — the close is the stronger thing to say about it.
export function arcEventAt(arc: QuestArc, index: number): ArcEvent | null {
  if (index === arc.lastMoment && arc.quest.status === 'done') return 'closed'
  if (index === arc.firstMoment) return 'started'
  if (index === arc.lastMoment) return 'last-line'
  return null
}

export function arcProgressAt(arc: QuestArc, index: number): { reached: number; total: number } {
  const reached = arc.moments.filter((momentIndex) => momentIndex <= index).length
  return { reached, total: arc.moments.length }
}

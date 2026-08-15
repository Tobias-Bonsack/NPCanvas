import type { CSSProperties } from 'react'
import type { Quest } from '../project/types.ts'

/**
 * The hues a new quest is drawn from, in the order they are handed out. Ordered so the first
 * few quests a user starts are maximally distinct rather than adjacent on the wheel.
 *
 * **No hue falls in 110–175.** That band is reserved for `QUEST_DONE_HUE`: a pin flies one
 * flag per quest, so a green flag has to mean "finished" and nothing else — an open quest that
 * happened to be green would be unreadable beside a done one.
 */
export const QUEST_HUES = [45, 265, 195, 330, 20, 240, 300, 85, 355, 215, 280, 60] as const

/** The one hue a finished quest wears, whatever colour it was given while it was open. */
export const QUEST_DONE_HUE = 145

/**
 * A hue no quest is already using, where one is left. Project-wide, unlike `nextZoneHue`:
 * quests are not scoped to a map, so two of them can share a pin and must never share a hue.
 *
 * Once every hue is taken the palette simply wraps — a duplicate colour is worse than no
 * colour only if it is the *only* thing distinguishing two quests, and the name always is.
 */
export function nextQuestHue(quests: readonly Quest[]): number {
  const used = new Set<number>()
  for (const quest of quests) used.add(quest.hue)
  return QUEST_HUES.find((hue) => !used.has(hue)) ?? QUEST_HUES[used.size % QUEST_HUES.length]
}

/** The single place status overrides a quest's own colour. */
export function questAccentHue(quest: Quest): number {
  return quest.status === 'done' ? QUEST_DONE_HUE : quest.hue
}

/**
 * A quest's hue as an inherited custom property, status applied. The pin's flag, the panel's
 * link and the board's card all build their own alphas from it in CSS, which is one
 * declaration here instead of three colour strings that could drift apart.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 */
export function questAccentStyle(quest: Quest): CSSProperties & Record<'--quest-hue', string> {
  return questHueStyle(questAccentHue(quest))
}

/**
 * The raw hue, ignoring status. The board's palette swatches need it: they must show what is
 * being picked, not what a done quest's status currently forces on top of it.
 */
export function questHueStyle(hue: number): CSSProperties & Record<'--quest-hue', string> {
  return { '--quest-hue': String(hue) }
}

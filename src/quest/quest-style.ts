import type { CSSProperties } from 'react'
import type { Quest } from '../project/types.ts'

// No hue falls in 110-175 — reserved for QUEST_DONE_HUE, so a green flag always means "finished".
export const QUEST_HUES = [45, 265, 195, 330, 20, 240, 300, 85, 355, 215, 280, 60] as const

export const QUEST_DONE_HUE = 145

// Project-wide, unlike nextZoneHue — quests aren't scoped to a map, so two can share a pin and
// must never share a hue. Once every hue is taken the palette simply wraps.
export function nextQuestHue(quests: readonly Quest[]): number {
  const used = new Set<number>()
  for (const quest of quests) used.add(quest.hue)
  return QUEST_HUES.find((hue) => !used.has(hue)) ?? QUEST_HUES[used.size % QUEST_HUES.length]
}

export function questAccentHue(quest: Quest): number {
  return quest.status === 'done' ? QUEST_DONE_HUE : quest.hue
}

// Intersection type avoids an `as` cast — CSSProperties has no index signature for `--*`.
export function questAccentStyle(quest: Quest): CSSProperties & Record<'--quest-hue', string> {
  return questHueStyle(questAccentHue(quest))
}

// The raw hue, ignoring status — the board's palette swatches must show what's being picked.
export function questHueStyle(hue: number): CSSProperties & Record<'--quest-hue', string> {
  return { '--quest-hue': String(hue) }
}

import type { RelevanceTag } from '../project/types.ts'

export type RelevanceStyle = {
  label: string
  /** 0..359. Chips, pin rings, and chart series all derive their color from this via hsl(). */
  hue: number
}

// Record (not a lookup function) so adding a tag to RELEVANCE_TAGS without a style
// here is a compile error. Hues are spread far enough apart to stay distinguishable
// when four of them sit side by side on one pin.
export const RELEVANCE_STYLE: Record<RelevanceTag, RelevanceStyle> = {
  'out-of-world': { label: 'Out of world', hue: 220 },
  worldbuilding: { label: 'Worldbuilding', hue: 150 },
  peoplebuilding: { label: 'Peoplebuilding', hue: 35 },
  other: { label: 'Other', hue: 290 },
}

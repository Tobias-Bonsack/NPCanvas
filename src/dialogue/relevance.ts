import type { CSSProperties } from 'react'
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

/**
 * A tag's hue as an inherited custom property, so every surface that shows relevance — a
 * form chip, a pin ring, later a chart series — derives its `hsl()` in CSS from the same
 * number instead of each assembling its own colour string in JS.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 */
export function relevanceHueStyle(
  tag: RelevanceTag,
): CSSProperties & Record<'--relevance-hue', string> {
  return { '--relevance-hue': String(RELEVANCE_STYLE[tag].hue) }
}

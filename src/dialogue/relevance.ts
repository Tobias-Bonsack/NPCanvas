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

/** Saturation and lightness are fixed across the app; only the hue distinguishes a tag. */
const SATURATION = '70%'
const LIGHTNESS = '60%'

/**
 * A tag's hue as an inherited custom property, for surfaces that build the colour in CSS —
 * a form chip needs the same hue at several alphas, and one property beats four declarations.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 */
export function relevanceHueStyle(
  tag: RelevanceTag,
): CSSProperties & Record<'--relevance-hue', string> {
  return { '--relevance-hue': String(RELEVANCE_STYLE[tag].hue) }
}

/** The same colour the CSS above resolves to, for surfaces that need it as a value. */
export function relevanceColor(tag: RelevanceTag): string {
  return `hsl(${RELEVANCE_STYLE[tag].hue} ${SATURATION} ${LIGHTNESS})`
}

/**
 * A pin's accent: every tag it carries, as equal segments of one ring.
 *
 * Untagged is deliberately the chrome's own neutral rather than a first-tag default —
 * "not yet classified" is real information, and a colour would claim otherwise. A single tag
 * skips the gradient because a one-stop conic is a solid fill the browser still rasterises.
 */
export function relevanceRingBackground(tags: readonly RelevanceTag[]): string {
  const first = tags[0]
  if (first === undefined) return 'var(--border-strong)'
  if (tags.length === 1) return relevanceColor(first)

  const share = 100 / tags.length
  const stops = tags.map(
    (tag, index) => `${relevanceColor(tag)} ${index * share}% ${(index + 1) * share}%`,
  )
  return `conic-gradient(${stops.join(', ')})`
}

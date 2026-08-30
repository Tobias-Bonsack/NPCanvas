import type { CSSProperties } from 'react'
import { newRelevanceTagId } from '../project/ids.ts'
import type { RelevanceTag, RelevanceTagId } from '../project/types.ts'
import { RELEVANCE_SLUGS_V4 } from '../project/types.ts'

// Saturation and lightness are fixed across the app; only the hue distinguishes a tag.
const SATURATION = '70%'
const LIGHTNESS = '60%'

// Same pattern as QUEST_HUES/ZONE_HUES, but no reserved band — a relevance tag carries no
// status that overrides its own colour.
export const RELEVANCE_HUES = [220, 150, 35, 290, 260, 10, 190, 320, 70, 235, 350, 110] as const

// Once every hue is taken the palette simply wraps.
export function nextRelevanceHue(tags: readonly RelevanceTag[]): number {
  const used = new Set<number>()
  for (const tag of tags) used.add(tag.hue)
  return (
    RELEVANCE_HUES.find((hue) => !used.has(hue)) ?? RELEVANCE_HUES[used.size % RELEVANCE_HUES.length]
  )
}

const DEFAULT_LABELS: Record<RelevanceSlugV4Key, string> = {
  'out-of-world': 'Out of world',
  worldbuilding: 'Worldbuilding',
  peoplebuilding: 'Peoplebuilding',
  other: 'Other',
}

const DEFAULT_HUES: Record<RelevanceSlugV4Key, number> = {
  'out-of-world': 220,
  worldbuilding: 150,
  peoplebuilding: 35,
  other: 290,
}

type RelevanceSlugV4Key = (typeof RELEVANCE_SLUGS_V4)[number]

// Seeded by createEmptyProject and by the V4->V5 migration, so a fresh and a migrated project
// are indistinguishable. Returned in RELEVANCE_SLUGS_V4 order so migrateV4 can zip slug to id.
export function defaultRelevanceTags(): RelevanceTag[] {
  return RELEVANCE_SLUGS_V4.map((slug) => ({
    id: newRelevanceTagId(),
    name: DEFAULT_LABELS[slug],
    hue: DEFAULT_HUES[slug],
  }))
}

// Intersection type avoids an `as` cast — CSSProperties has no index signature for `--*`.
export function relevanceHueStyle(hue: number): CSSProperties & Record<'--relevance-hue', string> {
  return { '--relevance-hue': String(hue) }
}

export function relevanceColor(hue: number): string {
  return `hsl(${hue} ${SATURATION} ${LIGHTNESS})`
}

// Past this many bands a hue is no longer distinguishable on a pin a few screen pixels wide
// (calibrated against the min-width in MapCanvas.css); extras collapse into one overflow band.
const MAX_PIN_BANDS = 6

// Never a real tag's hue, so the overflow band reads as "more", not as an unfamiliar category.
const OVERFLOW_BAND_COLOR = 'hsl(220 8% 45%)'

// Untagged is the chrome's own surface, not a first-tag default — "not yet classified" is real
// information a colour would misrepresent.
export function relevancePinBackground(hues: readonly number[]): string {
  const first = hues[0]
  if (first === undefined) return 'var(--surface-2)'
  if (hues.length === 1) return relevanceColor(first)

  const overflow = hues.length > MAX_PIN_BANDS
  const colors = overflow
    ? [...hues.slice(0, MAX_PIN_BANDS - 1).map(relevanceColor), OVERFLOW_BAND_COLOR]
    : hues.map(relevanceColor)

  // Hard stops, not a blend — a gradient between two categories would read as a third.
  const share = 100 / colors.length
  const stops = colors.map(
    (color, index) => `${color} ${index * share}% ${(index + 1) * share}%`,
  )
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

// Drops any id the hue map doesn't know — can't happen for a reducer-produced document, but
// is the safe answer for one mid-repair.
export function relevanceHues(
  ids: readonly RelevanceTagId[],
  hueByTag: ReadonlyMap<RelevanceTagId, number>,
): number[] {
  return ids.flatMap((id) => {
    const hue = hueByTag.get(id)
    return hue === undefined ? [] : [hue]
  })
}

export function relevanceNames(ids: readonly RelevanceTagId[], tags: readonly RelevanceTag[]): string[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag.name]))
  return ids.flatMap((id) => {
    const name = byId.get(id)
    return name === undefined ? [] : [name]
  })
}

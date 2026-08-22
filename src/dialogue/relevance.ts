import type { CSSProperties } from 'react'
import { newRelevanceTagId } from '../project/ids.ts'
import type { RelevanceTag, RelevanceTagId } from '../project/types.ts'
import { RELEVANCE_SLUGS_V4 } from '../project/types.ts'

/** Saturation and lightness are fixed across the app; only the hue distinguishes a tag. */
const SATURATION = '70%'
const LIGHTNESS = '60%'

/**
 * The hues a new relevance tag is drawn from, in the order they are handed out — the same
 * pattern `QUEST_HUES` and `ZONE_HUES` already establish. Unlike `QUEST_HUES` there is no
 * reserved band: a relevance tag carries no status that overrides its own colour.
 */
export const RELEVANCE_HUES = [220, 150, 35, 290, 260, 10, 190, 320, 70, 235, 350, 110] as const

/**
 * A hue no tag is already using, where one is left. Once every hue is taken the palette simply
 * wraps — a duplicate colour is worse than no colour only if it is the *only* thing
 * distinguishing two tags, and the name always is.
 */
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

/**
 * The four tags every project used to be born with, before a project could edit its own
 * vocabulary — seeded by `createEmptyProject` and by the V4→V5 migration, which is what makes a
 * fresh project and a migrated one indistinguishable. Returned in `RELEVANCE_SLUGS_V4` order, so
 * a caller may zip slug to id by index (see `migrateV4` in `data-file.ts`).
 */
export function defaultRelevanceTags(): RelevanceTag[] {
  return RELEVANCE_SLUGS_V4.map((slug) => ({
    id: newRelevanceTagId(),
    name: DEFAULT_LABELS[slug],
    hue: DEFAULT_HUES[slug],
  }))
}

/**
 * A hue as an inherited custom property, for surfaces that build the colour in CSS — a form
 * chip needs the same hue at several alphas, and one property beats four declarations.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 */
export function relevanceHueStyle(hue: number): CSSProperties & Record<'--relevance-hue', string> {
  return { '--relevance-hue': String(hue) }
}

/** The same colour the CSS above resolves to, for surfaces that need it as a value. */
export function relevanceColor(hue: number): string {
  return `hsl(${hue} ${SATURATION} ${LIGHTNESS})`
}

/**
 * A pin's fill: every tag it carries, as equal vertical bands across the whole pin — already
 * resolved to hues, since a tag's colour now lives on the document's own record rather than a
 * compiled-in lookup. `PinLayer` resolves each `RelevanceTagId` through the project's hue map
 * before calling this.
 *
 * The pin body rather than a ring around the glyph, because a ring is a few pixels of arc per
 * tag — at four tags the segments were too small to name a colour. Bands get the pin's full
 * width, which is also why `.pin__marker[data-tagged]` carries a min-width.
 *
 * Untagged is deliberately the chrome's own surface rather than a first-tag default: "not yet
 * classified" is real information, and a colour would claim otherwise. A single tag skips the
 * gradient because a one-stop gradient is a solid fill the browser still rasterises.
 */
export function relevancePinBackground(hues: readonly number[]): string {
  const first = hues[0]
  if (first === undefined) return 'var(--surface-2)'
  if (hues.length === 1) return relevanceColor(first)

  // Hard stops, not a blend: these are categories, and a gradient between two of them would
  // read as a third colour that means nothing.
  const share = 100 / hues.length
  const stops = hues.map(
    (hue, index) => `${relevanceColor(hue)} ${index * share}% ${(index + 1) * share}%`,
  )
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/** The hues a dialogue's relevance ids resolve to, in the order they are stored — dropping any
 *  id the hue map does not know, which cannot happen for a document the reducer produced but is
 *  the safe answer for one that is mid-repair. */
export function relevanceHues(
  ids: readonly RelevanceTagId[],
  hueByTag: ReadonlyMap<RelevanceTagId, number>,
): number[] {
  return ids.flatMap((id) => {
    const hue = hueByTag.get(id)
    return hue === undefined ? [] : [hue]
  })
}

/** The names a dialogue's relevance ids resolve to, in the order they are stored — for a label
 *  that lists tags by name rather than drawing their colour. */
export function relevanceNames(ids: readonly RelevanceTagId[], tags: readonly RelevanceTag[]): string[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag.name]))
  return ids.flatMap((id) => {
    const name = byId.get(id)
    return name === undefined ? [] : [name]
  })
}

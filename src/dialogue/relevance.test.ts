import { describe, expect, it } from 'vitest'
import { asRelevanceTagId } from '../project/ids.ts'
import type { RelevanceTag } from '../project/types.ts'
import {
  defaultRelevanceTags,
  nextRelevanceHue,
  relevanceColor,
  relevanceHues,
  relevanceNames,
  relevancePinBackground,
} from './relevance.ts'

function tag(id: string, name: string, hue: number): RelevanceTag {
  return { id: asRelevanceTagId(id), name, hue }
}

describe('relevancePinBackground', () => {
  it('is the chrome surface for an untagged dialogue, not a colour', () => {
    expect(relevancePinBackground([])).toBe('var(--surface-2)')
  })

  it('is a flat colour for one tag, with no gradient to rasterise', () => {
    expect(relevancePinBackground([150])).toBe(relevanceColor(150))
  })

  it('splits the pin into one equal band per tag, with hard stops between them', () => {
    const fill = relevancePinBackground([220, 150, 290])
    expect(fill).toBe(
      `linear-gradient(90deg, ${relevanceColor(220)} 0% ${100 / 3}%, ` +
        `${relevanceColor(150)} ${100 / 3}% ${200 / 3}%, ` +
        `${relevanceColor(290)} ${200 / 3}% 100%)`,
    )
  })

  it('spans the full width exactly, however many hues there are', () => {
    for (let count = 2; count <= 12; count++) {
      const hues = Array.from({ length: count }, (_, index) => index * 10)
      const fill = relevancePinBackground(hues)
      const lastStop = /(\d+(?:\.\d+)?)%\)$/.exec(fill)
      expect(lastStop).not.toBeNull()
      // Floating-point division of 100 by the band count does not always land on the exact
      // literal "100", so the end of the gradient is checked numerically instead.
      expect(Number(lastStop?.[1])).toBeCloseTo(100)
      // One `hsl(` per hue: a dropped or duplicated band would show as a wrong count.
      expect(fill.split('hsl(').length - 1).toBe(count)
    }
  })
})

describe('nextRelevanceHue', () => {
  it('hands out the palette in order and wraps once every hue is taken', () => {
    const tags: RelevanceTag[] = []
    expect(nextRelevanceHue(tags)).toBe(220)
    tags.push(tag('a', 'A', 220))
    expect(nextRelevanceHue(tags)).toBe(150)
  })
})

describe('defaultRelevanceTags', () => {
  it('seeds four distinctly hued tags, in RELEVANCE_SLUGS_V4 order', () => {
    const tags = defaultRelevanceTags()
    expect(tags.map((t) => t.name)).toEqual([
      'Out of world',
      'Worldbuilding',
      'Peoplebuilding',
      'Other',
    ])
    expect(tags.map((t) => t.hue)).toEqual([220, 150, 35, 290])
    expect(new Set(tags.map((t) => t.id)).size).toBe(4)
  })
})

describe('relevanceHues and relevanceNames', () => {
  const a = tag('a', 'Out of world', 220)
  const b = tag('b', 'Worldbuilding', 150)

  it('resolves ids to hues and names in stored order, dropping an unknown id', () => {
    const hueByTag = new Map([
      [a.id, a.hue],
      [b.id, b.hue],
    ])
    expect(relevanceHues([b.id, a.id], hueByTag)).toEqual([150, 220])
    expect(relevanceHues([asRelevanceTagId('gone'), a.id], hueByTag)).toEqual([220])
    expect(relevanceNames([b.id, a.id], [a, b])).toEqual(['Worldbuilding', 'Out of world'])
  })
})

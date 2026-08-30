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

  it('spans the full width exactly, however many bands are actually drawn', () => {
    for (let count = 2; count <= 12; count++) {
      const hues = Array.from({ length: count }, (_, index) => index * 10)
      const fill = relevancePinBackground(hues)
      const lastStop = /(\d+(?:\.\d+)?)%\)$/.exec(fill)
      expect(lastStop).not.toBeNull()
      expect(Number(lastStop?.[1])).toBeCloseTo(100) // floating-point, not always the literal "100"
      expect(fill.split('hsl(').length - 1).toBe(Math.min(count, 6)) // caps at six, incl. overflow marker
    }
  })

  it('pins the exact fill for two, four and twelve tags', () => {
    expect(relevancePinBackground([220, 150])).toBe(
      `linear-gradient(90deg, ${relevanceColor(220)} 0% 50%, ${relevanceColor(150)} 50% 100%)`,
    )

    const four = [220, 150, 35, 290]
    expect(relevancePinBackground(four)).toBe(
      `linear-gradient(90deg, ${four
        .map((hue, i) => `${relevanceColor(hue)} ${i * 25}% ${(i + 1) * 25}%`)
        .join(', ')})`,
    )

    // Twelve tags: only the first five keep their own hue, and the sixth and last band is the
    // overflow marker — never a seventh-plus real colour silently dropped.
    const twelve = Array.from({ length: 12 }, (_, index) => index * 10)
    const share = 100 / 6
    const colors = [...twelve.slice(0, 5).map(relevanceColor), 'hsl(220 8% 45%)']
    expect(relevancePinBackground(twelve)).toBe(
      `linear-gradient(90deg, ${colors
        .map((color, i) => `${color} ${i * share}% ${(i + 1) * share}%`)
        .join(', ')})`,
    )
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
  it('seeds four distinctly hued tags, in the default order', () => {
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

import { describe, expect, it } from 'vitest'
import { RELEVANCE_TAGS } from '../project/types.ts'
import { relevanceColor, relevanceRingBackground } from './relevance.ts'

describe('relevanceRingBackground', () => {
  it('is the chrome neutral for an untagged dialogue, not a colour', () => {
    expect(relevanceRingBackground([])).toBe('var(--border-strong)')
  })

  it('is a flat colour for one tag, with no gradient to rasterise', () => {
    expect(relevanceRingBackground(['worldbuilding'])).toBe(relevanceColor('worldbuilding'))
  })

  it('splits the ring into one equal segment per tag', () => {
    const ring = relevanceRingBackground(['out-of-world', 'worldbuilding', 'other'])
    expect(ring).toBe(
      `conic-gradient(${relevanceColor('out-of-world')} 0% ${100 / 3}%, ` +
        `${relevanceColor('worldbuilding')} ${100 / 3}% ${200 / 3}%, ` +
        `${relevanceColor('other')} ${200 / 3}% 100%)`,
    )
  })

  it('closes the ring exactly, however many tags there are', () => {
    for (let count = 2; count <= RELEVANCE_TAGS.length; count++) {
      const ring = relevanceRingBackground(RELEVANCE_TAGS.slice(0, count))
      expect(ring.endsWith(' 100%)')).toBe(true)
      // One `hsl(` per tag: a dropped or duplicated segment would show as a wrong count.
      expect(ring.split('hsl(').length - 1).toBe(count)
    }
  })

  it('gives every tag its own distinguishable colour', () => {
    const colors = new Set(RELEVANCE_TAGS.map(relevanceColor))
    expect(colors.size).toBe(RELEVANCE_TAGS.length)
  })
})

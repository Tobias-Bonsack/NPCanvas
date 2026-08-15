import { describe, expect, it } from 'vitest'
import { RELEVANCE_TAGS } from '../project/types.ts'
import { relevanceColor, relevancePinBackground } from './relevance.ts'

describe('relevancePinBackground', () => {
  it('is the chrome surface for an untagged dialogue, not a colour', () => {
    expect(relevancePinBackground([])).toBe('var(--surface-2)')
  })

  it('is a flat colour for one tag, with no gradient to rasterise', () => {
    expect(relevancePinBackground(['worldbuilding'])).toBe(relevanceColor('worldbuilding'))
  })

  it('splits the pin into one equal band per tag, with hard stops between them', () => {
    const fill = relevancePinBackground(['out-of-world', 'worldbuilding', 'other'])
    expect(fill).toBe(
      `linear-gradient(90deg, ${relevanceColor('out-of-world')} 0% ${100 / 3}%, ` +
        `${relevanceColor('worldbuilding')} ${100 / 3}% ${200 / 3}%, ` +
        `${relevanceColor('other')} ${200 / 3}% 100%)`,
    )
  })

  it('spans the full width exactly, however many tags there are', () => {
    for (let count = 2; count <= RELEVANCE_TAGS.length; count++) {
      const fill = relevancePinBackground(RELEVANCE_TAGS.slice(0, count))
      expect(fill.endsWith(' 100%)')).toBe(true)
      // One `hsl(` per tag: a dropped or duplicated band would show as a wrong count.
      expect(fill.split('hsl(').length - 1).toBe(count)
    }
  })

  it('gives every tag its own distinguishable colour', () => {
    const colors = new Set(RELEVANCE_TAGS.map(relevanceColor))
    expect(colors.size).toBe(RELEVANCE_TAGS.length)
  })
})

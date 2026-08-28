import { describe, expect, it } from 'vitest'
import type { DialogueMedia, MediaId } from '../project/types.ts'
import { resolveGalleryIndex, stepGalleryIndex } from './gallery-index.ts'

function medium(id: string): DialogueMedia {
  return {
    id: id as MediaId,
    kind: 'image',
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 1 },
    width: 10,
    height: 10,
  }
}

const media = [medium('a'), medium('b'), medium('c')]

describe('resolveGalleryIndex', () => {
  it('finds the medium carrying the id', () => {
    expect(resolveGalleryIndex(media, 'b' as MediaId)).toBe(1)
  })

  it('falls to the last frame for an id the list no longer holds', () => {
    expect(resolveGalleryIndex(media, 'gone' as MediaId)).toBe(2)
  })

  it('starts at the first frame when nothing is selected', () => {
    expect(resolveGalleryIndex(media, null)).toBe(0)
  })

  it('answers 0 for an empty list, whatever it was asked for', () => {
    expect(resolveGalleryIndex([], null)).toBe(0)
    expect(resolveGalleryIndex([], 'a' as MediaId)).toBe(0)
  })
})

describe('resolveGalleryIndex over a differently-branded id', () => {
  type CaptureId = string & { readonly brand: 'CaptureId' }
  function capture(id: string): { id: CaptureId } {
    return { id: id as CaptureId }
  }

  it('resolves the same way for a list of `{ id }` items with a different brand', () => {
    const captures = [capture('a'), capture('b')]
    expect(resolveGalleryIndex(captures, 'b' as CaptureId)).toBe(1)
    expect(resolveGalleryIndex(captures, 'gone' as CaptureId)).toBe(1)
  })
})

describe('stepGalleryIndex', () => {
  it('pages one frame at a time', () => {
    expect(stepGalleryIndex(0, 1, 3)).toBe(1)
    expect(stepGalleryIndex(2, -1, 3)).toBe(1)
  })

  it('clamps rather than wraps at both ends', () => {
    expect(stepGalleryIndex(2, 1, 3)).toBe(2)
    expect(stepGalleryIndex(0, -1, 3)).toBe(0)
  })

  it('stays at 0 for an empty list', () => {
    expect(stepGalleryIndex(0, 1, 0)).toBe(0)
  })
})

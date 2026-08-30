import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId } from '../project/ids.ts'
import type { Dialogue } from '../project/types.ts'
import {
  byTimeAsc,
  byTimeDesc,
  dialoguesByTimeAsc,
  dialoguesByTimeDesc,
  subsetByTimeAsc,
  subsetByTimeDesc,
} from './dialogue-order.ts'

const MAP = asMapId('map')

function dialogue(id: string, spokenAt: string): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: MAP,
    npcName: id,
    position: { x: 0, y: 0 },
    text: '',
    media: [],
    spokenAt,
    relevance: [],
    references: [],
  }
}

const A = dialogue('a', '2026-01-01T00:00:00.000Z')
const B = dialogue('b', '2026-06-01T00:00:00.000Z')
const C = dialogue('c', '2026-03-01T00:00:00.000Z')
const DIALOGUES = [B, A, C]

describe('dialoguesByTimeAsc / dialoguesByTimeDesc: caching', () => {
  it('returns the identical array for the identical input array', () => {
    const first = dialoguesByTimeAsc(DIALOGUES)
    expect(dialoguesByTimeAsc(DIALOGUES)).toBe(first)
  })

  it('recomputes when the array is a different reference, however equal it looks', () => {
    const first = dialoguesByTimeAsc(DIALOGUES)
    expect(dialoguesByTimeAsc([...DIALOGUES])).not.toBe(first)
  })

  it('never disagrees with a fresh sort', () => {
    const cached = dialoguesByTimeAsc(DIALOGUES)
    const fresh = [...DIALOGUES].sort(byTimeAsc)
    expect([...cached]).toEqual(fresh)

    const cachedDesc = dialoguesByTimeDesc(DIALOGUES)
    const freshDesc = [...DIALOGUES].sort(byTimeDesc)
    expect([...cachedDesc]).toEqual(freshDesc)
  })

  it('orders ascending earliest first and descending latest first', () => {
    expect(dialoguesByTimeAsc(DIALOGUES)).toEqual([A, C, B])
    expect(dialoguesByTimeDesc(DIALOGUES)).toEqual([B, C, A])
  })
})

describe('subsetByTimeAsc / subsetByTimeDesc', () => {
  it('places a subset in the same relative order as the full cached order', () => {
    const subset = [B, A]
    expect(subsetByTimeAsc(subset, DIALOGUES)).toEqual([A, B])
    expect(subsetByTimeDesc(subset, DIALOGUES)).toEqual([B, A])
  })

  it('never disagrees with sorting the subset directly', () => {
    const subset = [C, A, B]
    expect(subsetByTimeAsc(subset, DIALOGUES)).toEqual([...subset].sort(byTimeAsc))
    expect(subsetByTimeDesc(subset, DIALOGUES)).toEqual([...subset].sort(byTimeDesc))
  })
})

describe('cache invalidation', () => {
  it('a new dialogues array (as an add produces) is reflected immediately', () => {
    const before = dialoguesByTimeAsc(DIALOGUES)
    const added = dialogue('d', '2026-02-01T00:00:00.000Z')
    const after = [...DIALOGUES, added]
    const next = dialoguesByTimeAsc(after)
    expect(next).not.toBe(before)
    expect(next).toEqual([A, added, C, B])
  })

  it('serves the same answer it computed for an array seen before, not merely an equal one', () => {
    const first = dialoguesByTimeAsc(DIALOGUES)
    // A different question in between, the way a zone edit leaves `dialogues` untouched but a
    // route change re-reads the same array a moment later.
    dialoguesByTimeAsc([A])
    const again = dialoguesByTimeAsc(DIALOGUES)
    expect(again).not.toBe(first)
    expect(again).toEqual(first)
  })
})

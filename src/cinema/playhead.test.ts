import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asMediaId } from '../project/ids.ts'
import type { Dialogue, DialogueMedia } from '../project/types.ts'
import type { Playhead, PlayheadAction } from './playhead.ts'
import { frameMsFor, isAnnounceableMove, playheadReducer } from './playhead.ts'
import type { Moment, Reel } from './reel.ts'

const UNUSED_MAP = asMapId('unused-map')

// Mirrors `MIN_FRAME_MS` in playhead.ts — kept independent so the test still fails if the
// constant's value drifts unnoticed.
const MIN_FRAME_MS = 60

function frame(id: string): DialogueMedia {
  return {
    id: asMediaId(id),
    kind: 'image',
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 10 },
    width: 10,
    height: 10,
  }
}

function dialogueOf(id: string, mediaCount: number): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: UNUSED_MAP,
    npcName: 'Mara',
    position: { x: 0, y: 0 },
    text: '',
    media: Array.from({ length: mediaCount }, (_, index) => frame(`${id}-${index}`)),
    relevance: [],
    references: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
  }
}

function momentOf(id: string, index: number, sessionIndex: number, mediaCount: number, dwellMs = 1500): Moment {
  return {
    dialogue: dialogueOf(id, mediaCount),
    index,
    sessionIndex,
    gapMsBefore: 0,
    zoneId: null,
    dwellMs,
  }
}

function playheadOf(moment: number, overrides: Partial<Playhead> = {}): Playhead {
  return { moment, frame: 0, playing: false, speed: 1, ...overrides }
}

describe('playheadReducer', () => {
  it('walks the frames of a moment before advancing to the next moment', () => {
    const reel: Reel = { moments: [momentOf('a', 0, 0, 3), momentOf('b', 1, 0, 1)], sessions: [] }
    const first = playheadReducer(playheadOf(0), { kind: 'tick' }, reel)
    expect(first).toEqual(playheadOf(0, { frame: 1 }))
    const second = playheadReducer(first, { kind: 'tick' }, reel)
    expect(second).toEqual(playheadOf(0, { frame: 2 }))
    const third = playheadReducer(second, { kind: 'tick' }, reel)
    expect(third).toEqual(playheadOf(1, { frame: 0 }))
  })

  it('stops at the final frame of the final moment instead of wrapping around', () => {
    const reel: Reel = { moments: [momentOf('a', 0, 0, 1)], sessions: [] }
    const playing = playheadOf(0, { playing: true })
    const next = playheadReducer(playing, { kind: 'tick' }, reel)
    expect(next).toEqual(playheadOf(0, { playing: false }))
  })

  const resetCases: { label: string; action: PlayheadAction }[] = [
    { label: 'step', action: { kind: 'step', by: 1 } },
    { label: 'seek', action: { kind: 'seek', moment: 1 } },
    { label: 'jump', action: { kind: 'jump', to: 'end' } },
  ]
  for (const { label, action } of resetCases) {
    it(`resets frame to 0 on ${label}`, () => {
      const reel: Reel = { moments: [momentOf('a', 0, 0, 3), momentOf('b', 1, 0, 3)], sessions: [] }
      const state = playheadOf(0, { frame: 2 })
      expect(playheadReducer(state, action, reel).frame).toBe(0)
    })
  }

  it('clamps seek below the reel into the first moment', () => {
    const reel: Reel = { moments: [momentOf('a', 0, 0, 1), momentOf('b', 1, 0, 1)], sessions: [] }
    expect(playheadReducer(playheadOf(0), { kind: 'seek', moment: -5 }, reel).moment).toBe(0)
  })

  it('clamps seek above the reel into the last moment', () => {
    const reel: Reel = { moments: [momentOf('a', 0, 0, 1), momentOf('b', 1, 0, 1)], sessions: [] }
    expect(playheadReducer(playheadOf(0), { kind: 'seek', moment: 99 }, reel).moment).toBe(1)
  })

  it('is a no-op seeking an empty reel', () => {
    const reel: Reel = { moments: [], sessions: [] }
    const state = playheadOf(0)
    expect(playheadReducer(state, { kind: 'seek', moment: 3 }, reel)).toBe(state)
  })

  it('clamps a frame-seek to the current moment’s frame count', () => {
    const reel: Reel = { moments: [momentOf('a', 0, 0, 3)], sessions: [] }
    expect(playheadReducer(playheadOf(0), { kind: 'frame-seek', frame: 99 }, reel).frame).toBe(2)
    expect(playheadReducer(playheadOf(0), { kind: 'frame-seek', frame: -1 }, reel).frame).toBe(0)
    expect(playheadReducer(playheadOf(0), { kind: 'frame-seek', frame: 1 }, reel).frame).toBe(1)
  })

  it('jumps to the next session at its first moment', () => {
    const first = momentOf('a', 0, 0, 1)
    const second = momentOf('b', 1, 1, 1)
    const reel: Reel = {
      moments: [first, second],
      sessions: [
        { index: 0, firstMoment: first, lastMoment: first, gapMsBefore: 0 },
        { index: 1, firstMoment: second, lastMoment: second, gapMsBefore: 40 * 60_000 },
      ],
    }
    expect(playheadReducer(playheadOf(0), { kind: 'jump', to: 'session-next' }, reel).moment).toBe(1)
  })

  it('is a no-op jumping past the last session', () => {
    const only = momentOf('a', 0, 0, 1)
    const reel: Reel = {
      moments: [only],
      sessions: [{ index: 0, firstMoment: only, lastMoment: only, gapMsBefore: 0 }],
    }
    expect(playheadReducer(playheadOf(0), { kind: 'jump', to: 'session-next' }, reel).moment).toBe(0)
  })

  it('is a no-op jumping before the first session', () => {
    const only = momentOf('a', 0, 0, 1)
    const reel: Reel = {
      moments: [only],
      sessions: [{ index: 0, firstMoment: only, lastMoment: only, gapMsBefore: 0 }],
    }
    expect(playheadReducer(playheadOf(0), { kind: 'jump', to: 'session-prev' }, reel).moment).toBe(0)
  })
})

describe('isAnnounceableMove', () => {
  it('announces a deliberate move but stays quiet for a tick', () => {
    expect(isAnnounceableMove({ kind: 'step', by: 1 })).toBe(true)
    expect(isAnnounceableMove({ kind: 'seek', moment: 2 })).toBe(true)
    expect(isAnnounceableMove({ kind: 'pause' })).toBe(true)
    expect(isAnnounceableMove({ kind: 'tick' })).toBe(false)
  })
})

describe('frameMsFor', () => {
  it('flips a multi-frame moment at a flat rate, independent of frame count', () => {
    const few = momentOf('a', 0, 0, 4, 1200)
    const many = momentOf('b', 1, 0, 50, 12_000)
    expect(frameMsFor(few, 1)).toBe(frameMsFor(many, 1))
  })

  it('spends the whole dwell budget on a single-frame moment', () => {
    const moment = momentOf('a', 0, 0, 1, 400)
    expect(frameMsFor(moment, 1)).toBe(400)
  })

  it('divides again by speed', () => {
    const moment = momentOf('a', 0, 0, 1, 400)
    expect(frameMsFor(moment, 4)).toBe(100)
  })

  it('floors at MIN_FRAME_MS rather than strobing at an extreme speed', () => {
    const moment = momentOf('a', 0, 0, 50, 1500)
    // Normal speeds top out at 4, where the flat per-frame rate stays well above the floor —
    // this exercises the floor itself, independent of what speeds happen to be offered today.
    expect(frameMsFor(moment, 100)).toBe(MIN_FRAME_MS)
  })
})

import { describe, expect, it } from 'vitest'
import { asCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile } from '../project/types.ts'
import type { CaptureState } from './use-capture.ts'
import { isCaptureBusy } from './use-capture.ts'

const PROFILE: CaptureProfile = {
  id: asCaptureProfileId('profile-1'),
  name: 'Pokémon Red',
  frameWidth: 1998,
  frameHeight: 1123,
  screenRect: { x: 37.5, y: 91, width: 420, height: 360 },
  nativeWidth: 160,
  nativeHeight: 144,
  textRect: { x: 8, y: 96, width: 144, height: 40 },
}

const LEARNING: CaptureState = {
  kind: 'learning',
  profile: PROFILE,
  glyphs: [],
  frame: {} as ImageData,
  tiles: [],
}

describe('isCaptureBusy', () => {
  it('is idle before any press', () => {
    expect(isCaptureBusy({ kind: 'idle' })).toBe(false)
  })

  it('is busy while a press is in flight', () => {
    expect(isCaptureBusy({ kind: 'capturing' })).toBe(true)
  })

  it('is busy while the learner overlay is up', () => {
    expect(isCaptureBusy(LEARNING)).toBe(true)
  })

  it('is idle once a press has finished, whichever way it ended', () => {
    expect(isCaptureBusy({ kind: 'done', message: 'ok' })).toBe(false)
    expect(isCaptureBusy({ kind: 'failed', message: 'no' })).toBe(false)
  })
})

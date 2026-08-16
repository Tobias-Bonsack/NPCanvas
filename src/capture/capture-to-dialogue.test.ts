import { describe, expect, it } from 'vitest'
import { asCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile } from '../project/types.ts'
import type { CaptureSource } from './capture-session.ts'
import { captureBlocker, describeCapture } from './capture-to-dialogue.ts'

const PROFILE: CaptureProfile = {
  id: asCaptureProfileId('profile-1'),
  name: 'Pokémon Red',
  frameWidth: 1998,
  frameHeight: 1123,
  screenRect: { x: 37.5, y: 91, width: 420, height: 360 },
  nativeWidth: 160,
  nativeHeight: 144,
  textRect: { x: 8, y: 96, width: 144, height: 40 },
  glyphs: [],
}

const LIVE: CaptureSource = {
  kind: 'live',
  label: 'Window · VisualBoyAdvance-M',
  frameWidth: 1998,
  frameHeight: 1123,
}

describe('captureBlocker', () => {
  it('lets a live source with a matching profile through', () => {
    expect(captureBlocker(LIVE, PROFILE)).toBeNull()
  })

  it('names connecting as the fix when nothing is shared', () => {
    expect(captureBlocker({ kind: 'idle' }, PROFILE)).toMatch(/connect/i)
    expect(captureBlocker({ kind: 'failed', message: 'gone' }, PROFILE)).toMatch(/connect/i)
    expect(captureBlocker({ kind: 'requesting' }, PROFILE)).toMatch(/picker/i)
  })

  it('names calibration as the fix when the project has no profile', () => {
    expect(captureBlocker(LIVE, null)).toMatch(/calibrate/i)
  })

  it('names both sizes when the frame is not the one the profile was drawn against', () => {
    const blocker = captureBlocker({ ...LIVE, frameWidth: 1280, frameHeight: 720 }, PROFILE)
    expect(blocker).toContain('1998 × 1123')
    expect(blocker).toContain('1280 × 720')
  })

  it('blocks on the connection before the profile, since one cannot be checked without the other', () => {
    expect(captureBlocker({ kind: 'idle' }, null)).toMatch(/connect/i)
  })
})

describe('describeCapture', () => {
  it('says the first picture is the one the pin shows', () => {
    expect(describeCapture({ text: 'appended', picture: 1 })).toContain('pin')
  })

  it('numbers every picture after the first', () => {
    expect(describeCapture({ text: 'appended', picture: 3 })).toContain('picture 3')
  })

  it('says the line is unchanged rather than staying silent', () => {
    expect(describeCapture({ text: 'unchanged', picture: 2 })).toMatch(/unchanged/i)
  })

  it('says the text was not transcribed, and what to do about it', () => {
    const message = describeCapture({ text: 'not-transcribed', picture: 1 })
    expect(message).toMatch(/not transcribed/i)
    expect(message).toMatch(/alphabet/i)
  })
})

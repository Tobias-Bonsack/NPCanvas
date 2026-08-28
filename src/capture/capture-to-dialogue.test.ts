import { describe, expect, it } from 'vitest'
import { asCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile } from '../project/types.ts'
import type { CaptureSource } from './capture-session.ts'
import { appendOutcome, captureBlocker, describeCapture } from './capture-to-dialogue.ts'

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

describe('appendOutcome', () => {
  it('appends only what the line does not already say', () => {
    const outcome = appendOutcome('HELLO THERE!', 'THERE! I AM OAK.')
    expect(outcome.text).toBe('appended')
    expect(outcome.next).toBe('HELLO THERE! I AM OAK.')
  })

  it('reports the same frame read twice as unchanged, with the line untouched', () => {
    const existing = 'HELLO THERE!'
    const outcome = appendOutcome(existing, 'HELLO THERE!')
    expect(outcome.text).toBe('unchanged')
    // Identically, so a caller can decide not to write by comparing references.
    expect(outcome.next).toBe(existing)
  })

  it('leaves the line alone when the box could not be read whole', () => {
    const existing = 'HELLO THERE!'
    const outcome = appendOutcome(existing, null)
    expect(outcome.text).toBe('not-transcribed')
    expect(outcome.next).toBe(existing)
  })

  it('treats an empty box as nothing to add', () => {
    expect(appendOutcome('HELLO', '').text).toBe('unchanged')
  })

  it('appends to an empty line', () => {
    expect(appendOutcome('', 'HELLO')).toEqual({ text: 'appended', next: 'HELLO' })
  })
})

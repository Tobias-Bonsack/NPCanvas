import { describe, expect, it } from 'vitest'
import { describeCaptureSource } from './capture-session.ts'

describe('describeCaptureSource', () => {
  it('names the surface kind and keeps the raw label beside it', () => {
    expect(describeCaptureSource('window', 'window:12345:0')).toBe('Window · window:12345:0')
    expect(describeCaptureSource('monitor', 'screen:0:0')).toBe('Screen · screen:0:0')
    expect(describeCaptureSource('browser', 'web-contents-media-stream://5')).toBe(
      'Browser tab · web-contents-media-stream://5',
    )
  })

  it('falls back when Chromium reports a surface it does not know or none at all', () => {
    expect(describeCaptureSource(undefined, 'something:1')).toBe('Capture source · something:1')
    expect(describeCaptureSource('application', 'x')).toBe('Capture source · x')
  })

  it('drops an empty label rather than leaving a dangling separator', () => {
    expect(describeCaptureSource('window', '')).toBe('Window')
    expect(describeCaptureSource('window', '   ')).toBe('Window')
  })
})

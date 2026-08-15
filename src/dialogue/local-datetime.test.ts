import { describe, expect, it } from 'vitest'
import { fromLocalDateTimeValue, toLocalDateTimeValue } from './local-datetime.ts'

describe('toLocalDateTimeValue', () => {
  it('renders the local wall clock, not the UTC one', () => {
    const iso = '2026-08-15T14:30:00.000Z'
    const local = new Date(iso)
    expect(toLocalDateTimeValue(iso)).toBe(
      `${local.getFullYear()}-${two(local.getMonth() + 1)}-${two(local.getDate())}` +
        `T${two(local.getHours())}:${two(local.getMinutes())}`,
    )
  })

  it('pads every component to the width the control expects', () => {
    // Constructed from local components, so the assertion holds in any timezone.
    const iso = new Date(2026, 0, 2, 3, 4).toISOString()
    expect(toLocalDateTimeValue(iso)).toBe('2026-01-02T03:04')
  })

  it('returns an empty value for an unparseable instant', () => {
    expect(toLocalDateTimeValue('not a date')).toBe('')
  })
})

describe('fromLocalDateTimeValue', () => {
  it('rejects a half-typed value rather than inventing an instant', () => {
    expect(fromLocalDateTimeValue('')).toBeNull()
    expect(fromLocalDateTimeValue('2026-08')).toBeNull()
    expect(fromLocalDateTimeValue('2026-08-15T14')).toBeNull()
  })

  it('ignores the seconds Chromium appends at a finer step', () => {
    expect(fromLocalDateTimeValue('2026-08-15T14:30:45')).toBe(
      fromLocalDateTimeValue('2026-08-15T14:30'),
    )
  })
})

describe('round trip', () => {
  it('leaves the wall-clock time the user sees unchanged', () => {
    for (const value of ['2026-08-15T14:30', '2026-01-01T00:00', '2026-12-31T23:59']) {
      const iso = fromLocalDateTimeValue(value)
      expect(iso).not.toBeNull()
      expect(toLocalDateTimeValue(iso ?? '')).toBe(value)
    }
  })

  it('survives a summer/winter pair, where a naive offset would drift by an hour', () => {
    for (const value of ['2026-07-01T12:00', '2026-02-01T12:00']) {
      expect(toLocalDateTimeValue(fromLocalDateTimeValue(value) ?? '')).toBe(value)
    }
  })
})

function two(value: number): string {
  return String(value).padStart(2, '0')
}

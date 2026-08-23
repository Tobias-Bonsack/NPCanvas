import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId } from '../project/ids.ts'
import type { Dialogue } from '../project/types.ts'
import { bucketDialogues, chooseBucketUnit } from './timeline-buckets.ts'

const HARBOUR = asMapId('harbour')

/** Local wall-clock, because the buckets are local calendar units — see `floorTo`. */
function at(local: string): Dialogue {
  return {
    id: asDialogueId(local),
    mapId: HARBOUR,
    npcName: 'Mara',
    position: { x: 0, y: 0 },
    text: '',
    media: [],
    spokenAt: new Date(local).toISOString(),
    relevance: [],
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('chooseBucketUnit', () => {
  it('takes the finest unit that stays under sixty buckets', () => {
    expect(chooseBucketUnit(0)).toBe('hour')
    expect(chooseBucketUnit(48 * HOUR)).toBe('hour')
    expect(chooseBucketUnit(10 * DAY)).toBe('day')
    expect(chooseBucketUnit(200 * DAY)).toBe('week')
    expect(chooseBucketUnit(3 * 365 * DAY)).toBe('month')
  })

  it('falls back to months for a range no unit can hold', () => {
    expect(chooseBucketUnit(200 * 365 * DAY)).toBe('month')
  })
})

describe('bucketDialogues', () => {
  it('has no buckets and no axis to divide by when there is nothing', () => {
    expect(bucketDialogues([])).toEqual({ unit: 'day', buckets: [] })
  })

  it('puts a single dialogue in a single bucket', () => {
    const only = at('2026-08-14T10:30:00')
    const { unit, buckets } = bucketDialogues([only])
    expect(unit).toBe('hour')
    expect(buckets).toHaveLength(1)
    expect(buckets[0].dialogues).toEqual([only])
    expect(new Date(buckets[0].start).getHours()).toBe(10)
    expect(new Date(buckets[0].start).getMinutes()).toBe(0)
  })

  it('skips a unit nothing was said in, rather than drawing it empty', () => {
    const { unit, buckets } = bucketDialogues([at('2026-08-01T09:00'), at('2026-08-05T09:00')])
    expect(unit).toBe('day')
    expect(buckets).toHaveLength(2)
    expect(buckets.map((bucket) => bucket.dialogues.length)).toEqual([1, 1])
  })

  it('returns ascending, non-empty, half-open buckets — the invariant the axis draws from', () => {
    const { buckets } = bucketDialogues([
      at('2026-08-01T09:00'),
      at('2026-08-04T09:00'),
      at('2026-08-04T11:00'),
    ])
    for (const [index, bucket] of buckets.entries()) {
      expect(bucket.dialogues.length).toBeGreaterThan(0)
      expect(bucket.start).toBeLessThan(bucket.end)
      if (index > 0) expect(bucket.start).toBeGreaterThanOrEqual(buckets[index - 1].end)
    }
  })

  it('files every dialogue exactly once, including several in one bucket', () => {
    const dialogues = [
      at('2026-08-01T09:00'),
      at('2026-08-01T21:00'),
      at('2026-08-05T09:00'),
      at('2026-08-03T09:00'),
    ]
    const { buckets } = bucketDialogues(dialogues)
    expect(buckets.map((bucket) => bucket.dialogues.length)).toEqual([2, 1, 1])
    expect(buckets.flatMap((bucket) => bucket.dialogues)).toHaveLength(dialogues.length)
  })

  it('starts week buckets on a Monday', () => {
    const { unit, buckets } = bucketDialogues([at('2026-08-01T09:00'), at('2027-01-15T09:00')])
    expect(unit).toBe('week')
    // 1 Aug 2026 is a Saturday, so its week began on Monday 27 July.
    expect(new Date(buckets[0].start).getDay()).toBe(1)
    expect(new Date(buckets[0].start).getDate()).toBe(27)
  })

  it('starts month buckets on the first', () => {
    const { unit, buckets } = bucketDialogues([at('2024-03-17T09:00'), at('2026-08-14T09:00')])
    expect(unit).toBe('month')
    expect(new Date(buckets[0].start).getDate()).toBe(1)
    expect(new Date(buckets[0].start).getMonth()).toBe(2)
  })

  it('drops a dialogue whose instant will not parse rather than inventing a date for it', () => {
    const good = at('2026-08-14T10:00')
    const broken: Dialogue = { ...good, id: asDialogueId('broken'), spokenAt: 'not a date' }
    const { buckets } = bucketDialogues([good, broken])
    expect(buckets.flatMap((bucket) => bucket.dialogues)).toEqual([good])
  })
})

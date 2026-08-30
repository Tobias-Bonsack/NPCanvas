import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId } from '../project/ids.ts'
import type { Dialogue } from '../project/types.ts'
import { autoBucketUnit, bucketDialogues } from './timeline-buckets.ts'

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
    references: [],
  }
}

/** `count` dialogues, one per `step`-th of `unit`, starting at `from` — local wall-clock. */
function every(count: number, from: string, step: (index: number) => Partial<Record<'days' | 'hours', number>>): Dialogue[] {
  return Array.from({ length: count }, (_, index) => {
    const { days = 0, hours = 0 } = step(index)
    const base = new Date(from)
    const when = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + days,
      base.getHours() + hours,
    )
    return { ...at(from), id: asDialogueId(`d${index}`), spokenAt: when.toISOString() }
  })
}

describe('autoBucketUnit', () => {
  it('has nothing to size against without a datable line, so it names the empty unit', () => {
    expect(autoBucketUnit([])).toBe('day')
  })

  it('takes the finest unit that stays under sixty buckets', () => {
    expect(autoBucketUnit([at('2026-08-14T10:30')])).toBe('hour')
    // Ten days, two hours a day: 240 hours elapsed but only 20 bars, so hours still fit.
    expect(
      autoBucketUnit(
        every(20, '2026-08-01T20:00', (index) => ({ days: Math.floor(index / 2), hours: index % 2 })),
      ),
    ).toBe('hour')
    // Every hour of ten days is 240 occupied hour-buckets but only 10 days.
    expect(
      autoBucketUnit(every(240, '2026-08-01T00:00', (index) => ({ hours: index }))),
    ).toBe('day')
    // Every day of a year: 365 days, 53 weeks.
    expect(autoBucketUnit(every(365, '2026-01-01T09:00', (index) => ({ days: index })))).toBe('week')
    // Every day of five years is more weeks than the ceiling holds, so months.
    expect(autoBucketUnit(every(1826, '2026-01-01T09:00', (index) => ({ days: index })))).toBe(
      'month',
    )
  })
})

describe('bucketDialogues', () => {
  it('has no buckets and no axis to divide by when there is nothing', () => {
    expect(bucketDialogues([], 'day')).toEqual([])
  })

  it('puts a single dialogue in a single bucket', () => {
    const only = at('2026-08-14T10:30:00')
    const buckets = bucketDialogues([only], 'hour')
    expect(buckets).toHaveLength(1)
    expect(buckets[0].dialogues).toEqual([only])
    expect(new Date(buckets[0].start).getHours()).toBe(10)
    expect(new Date(buckets[0].start).getMinutes()).toBe(0)
  })

  it('skips a unit nothing was said in, rather than drawing it empty', () => {
    const buckets = bucketDialogues([at('2026-08-01T09:00'), at('2026-08-05T09:00')], 'day')
    expect(buckets).toHaveLength(2)
    expect(buckets.map((bucket) => bucket.dialogues.length)).toEqual([1, 1])
  })

  it('returns ascending, non-empty, half-open buckets — the invariant the axis draws from', () => {
    const buckets = bucketDialogues(
      [at('2026-08-01T09:00'), at('2026-08-04T09:00'), at('2026-08-04T11:00')],
      'day',
    )
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
    const buckets = bucketDialogues(dialogues, 'day')
    expect(buckets.map((bucket) => bucket.dialogues.length)).toEqual([2, 1, 1])
    expect(buckets.flatMap((bucket) => bucket.dialogues)).toHaveLength(dialogues.length)
  })

  it('starts week buckets on a Monday', () => {
    const buckets = bucketDialogues([at('2026-08-01T09:00'), at('2027-01-15T09:00')], 'week')
    // 1 Aug 2026 is a Saturday, so its week began on Monday 27 July.
    expect(new Date(buckets[0].start).getDay()).toBe(1)
    expect(new Date(buckets[0].start).getDate()).toBe(27)
  })

  it('starts month buckets on the first', () => {
    const buckets = bucketDialogues([at('2024-03-17T09:00'), at('2026-08-14T09:00')], 'month')
    expect(new Date(buckets[0].start).getDate()).toBe(1)
    expect(new Date(buckets[0].start).getMonth()).toBe(2)
  })

  it('honours a forced coarse unit that Auto would never have chosen', () => {
    const twoHours = [at('2026-08-14T10:30'), at('2026-08-14T13:00')]
    expect(autoBucketUnit(twoHours)).toBe('hour')
    expect(bucketDialogues(twoHours, 'month')).toHaveLength(1)
    expect(bucketDialogues(twoHours, 'hour')).toHaveLength(2)
  })

  it('drops a dialogue whose instant will not parse rather than inventing a date for it', () => {
    const good = at('2026-08-14T10:00')
    const broken: Dialogue = { ...good, id: asDialogueId('broken'), spokenAt: 'not a date' }
    const buckets = bucketDialogues([good, broken], 'hour')
    expect(buckets.flatMap((bucket) => bucket.dialogues)).toEqual([good])
  })
})

import { assertNever } from '../assert-never.ts'
import type { Dialogue } from '../project/types.ts'

/**
 * The bucket sizes, coarsest last. A calendar ladder rather than "nice" millisecond steps:
 * every label the axis can print is a unit a person actually names, and month/week boundaries
 * are what make two sessions a fortnight apart line up.
 */
export const BUCKET_UNITS = ['hour', 'day', 'week', 'month'] as const
export type BucketUnit = (typeof BUCKET_UNITS)[number]

/**
 * Half-open `[start, end)`, in epoch milliseconds, and never empty.
 *
 * Buckets are strictly ascending but **not** contiguous: `end` need not equal the next bucket's
 * `start`, because a unit in which nothing was said produces no bucket at all. The x axis a
 * caller draws from these is therefore ordinal — one slot per bucket — rather than proportional
 * to elapsed time.
 */
export type TimeBucket = {
  start: number
  end: number
  dialogues: Dialogue[]
}

/**
 * Above this the bars are thinner than the gaps between them and the axis labels collide.
 * The ladder is coarse, so landing in the 30–60 band is a target rather than a guarantee.
 */
const MAX_BUCKETS = 60

/**
 * The finest unit whose *occupied* buckets stay under the ceiling — the default the grain picker
 * calls "Auto".
 *
 * Counting occupied buckets rather than the elapsed span is the consequence of a bucket only
 * existing where something was said: two hours a day for ten days spans 240 hours but draws
 * twenty bars, and coarsening that to ten day-bars throws away detail the axis had room for.
 */
export function autoBucketUnit(dialogues: readonly Dialogue[]): BucketUnit {
  const instants = datedInstants(dialogues)
  // Nothing datable is nothing to size against, and 'day' is the unit the empty caption names.
  if (instants.length === 0) return 'day'
  return BUCKET_UNITS.find((unit) => occupiedBuckets(instants, unit) <= MAX_BUCKETS) ?? 'month'
}

function occupiedBuckets(instants: readonly number[], unit: BucketUnit): number {
  const starts = new Set<number>()
  for (const at of instants) starts.add(floorTo(new Date(at), unit).getTime())
  return starts.size
}

/**
 * A dialogue whose `spokenAt` will not parse has no place on a time axis and is dropped; a
 * hand-edited `data.json` is the user's to fix, and inventing an instant would file the line
 * under a date nobody wrote.
 */
function datedInstants(dialogues: readonly Dialogue[]): number[] {
  return dialogues.flatMap((dialogue) => {
    const at = Date.parse(dialogue.spokenAt)
    return Number.isNaN(at) ? [] : [at]
  })
}

/**
 * Every dialogue placed on one bucket per calendar unit that holds at least one of them.
 *
 * A unit nothing was said in gets no bucket. The alternative — a slot, a label and a focus stop
 * spent on an empty hour — is a third of a chart carrying no measurement, and the chart is read
 * for where the lines *are*. The cost is that the axis no longer reads as elapsed time; the
 * caller's slots are equal width whatever the gap between two buckets.
 *
 * Boundaries are local-time calendar boundaries, so a "day" is the user's day — 23 or 25 hours
 * across a DST change, which is exactly what the axis label claims it is.
 *
 * The unit is an argument rather than a derivation: it is the reader's to choose, and `Timeline`
 * hands in either the picker's answer or `autoBucketUnit`'s.
 *
 * A dialogue whose `spokenAt` will not parse is dropped — see `datedInstants` for why.
 */
export function bucketDialogues(
  dialogues: readonly Dialogue[],
  unit: BucketUnit,
): TimeBucket[] {
  const dated = dialogues
    .flatMap((dialogue) => {
      const at = Date.parse(dialogue.spokenAt)
      return Number.isNaN(at) ? [] : [{ dialogue, at }]
    })
    .sort((a, b) => a.at - b.at)

  // `dated` is sorted, so a bucket is only ever extended while it is the last one — one pass
  // builds the whole ascending run, and no bucket is created that nothing goes into.
  const buckets: TimeBucket[] = []
  for (const entry of dated) {
    const start = floorTo(new Date(entry.at), unit)
    const open = buckets[buckets.length - 1]
    if (open !== undefined && open.start === start.getTime()) {
      open.dialogues.push(entry.dialogue)
      continue
    }
    buckets.push({
      start: start.getTime(),
      end: advance(start, unit).getTime(),
      dialogues: [entry.dialogue],
    })
  }

  return buckets
}

/** The start of the calendar unit containing `date`, in local time. Weeks start on Monday. */
function floorTo(date: Date, unit: BucketUnit): Date {
  switch (unit) {
    case 'hour':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours())
    case 'day':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate())
    case 'week': {
      // getDay() is Sunday-based; the shift makes Monday the first day of the week.
      const offset = (date.getDay() + 6) % 7
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset)
    }
    case 'month':
      return new Date(date.getFullYear(), date.getMonth(), 1)
    default:
      return assertNever(unit)
  }
}

/** The next boundary. Component arithmetic, so DST and month lengths take care of themselves. */
function advance(date: Date, unit: BucketUnit): Date {
  switch (unit) {
    case 'hour':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1)
    case 'day':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    case 'week':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7)
    case 'month':
      return new Date(date.getFullYear(), date.getMonth() + 1, 1)
    default:
      return assertNever(unit)
  }
}

/**
 * Axis labels at a granularity matching the bucket, via `Intl` — see CLAUDE.md § Dependencies.
 * Built once per unit rather than per tick: a formatter is expensive to construct and there are
 * only four of them.
 */
const BUCKET_FORMAT: Record<BucketUnit, Intl.DateTimeFormat> = {
  hour: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric' }),
  day: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }),
  week: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }),
  month: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }),
}

export function formatBucketStart(start: number, unit: BucketUnit): string {
  return BUCKET_FORMAT[unit].format(new Date(start))
}

const BUCKET_UNIT_NOUN: Record<BucketUnit, string> = {
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
}

/** "the week of 3 Aug" — the accessible name of a bar, and the heading of its detail list. */
export function describeBucket(bucket: TimeBucket, unit: BucketUnit): string {
  return `${BUCKET_UNIT_NOUN[unit]} of ${formatBucketStart(bucket.start, unit)}`
}

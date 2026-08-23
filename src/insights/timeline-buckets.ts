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

export type BucketedTimeline = {
  unit: BucketUnit
  buckets: TimeBucket[]
}

/**
 * Above this the bars are thinner than the gaps between them and the axis labels collide.
 * The ladder is coarse, so landing in the 30–60 band is a target rather than a guarantee: a
 * ten-day project gets ten day-buckets, because 240 hour-buckets would be worse in every way.
 */
const MAX_BUCKETS = 60

/** Nominal lengths, used only to pick the unit; the real boundaries are calendar-derived. */
const APPROXIMATE_MS: Record<BucketUnit, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
}

/** The finest unit that keeps the bar count under the ceiling. Chosen from the data, never set. */
export function chooseBucketUnit(spanMs: number): BucketUnit {
  return BUCKET_UNITS.find((unit) => spanMs / APPROXIMATE_MS[unit] <= MAX_BUCKETS) ?? 'month'
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
 * A dialogue whose `spokenAt` will not parse has no place on a time axis and is dropped; a
 * hand-edited `data.json` is the user's to fix, and inventing an instant would file the line
 * under a date nobody wrote.
 */
export function bucketDialogues(dialogues: readonly Dialogue[]): BucketedTimeline {
  const dated = dialogues
    .flatMap((dialogue) => {
      const at = Date.parse(dialogue.spokenAt)
      return Number.isNaN(at) ? [] : [{ dialogue, at }]
    })
    .sort((a, b) => a.at - b.at)

  const first = dated[0]
  const last = dated[dated.length - 1]
  if (first === undefined || last === undefined) return { unit: 'day', buckets: [] }

  // One instant is a span of zero, which picks the finest unit and produces a single bucket —
  // no division by a zero range anywhere, because nothing here divides by the span.
  const unit = chooseBucketUnit(last.at - first.at)

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

  return { unit, buckets }
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

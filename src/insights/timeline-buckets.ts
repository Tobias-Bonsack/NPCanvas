import { assertNever } from '../assert-never.ts'
import { dialoguesByTimeAsc } from '../dialogue/dialogue-order.ts'
import type { Dialogue } from '../project/types.ts'

// A calendar ladder, not "nice" millisecond steps — every label is a unit a person names, and
// month/week boundaries line up sessions a fortnight apart.
export const BUCKET_UNITS = ['hour', 'day', 'week', 'month'] as const
export type BucketUnit = (typeof BUCKET_UNITS)[number]

// Half-open [start, end) in epoch ms, never empty. Strictly ascending but not contiguous — a
// unit nothing was said in produces no bucket, so the x axis a caller draws is ordinal, not
// proportional to elapsed time.
export type TimeBucket = {
  start: number
  end: number
  dialogues: Dialogue[]
}

// Above this bars are thinner than their gaps and axis labels collide.
const MAX_BUCKETS = 60

// Counts occupied buckets, not elapsed span — two hours/day for ten days spans 240 hours but
// draws twenty bars; coarsening to ten day-bars would throw away detail the axis had room for.
export function autoBucketUnit(dialogues: readonly Dialogue[]): BucketUnit {
  const instants = datedInstants(dialogues)
  if (instants.length === 0) return 'day'
  return BUCKET_UNITS.find((unit) => occupiedBuckets(instants, unit) <= MAX_BUCKETS) ?? 'month'
}

function occupiedBuckets(instants: readonly number[], unit: BucketUnit): number {
  const starts = new Set<number>()
  for (const at of instants) starts.add(floorTo(new Date(at), unit).getTime())
  return starts.size
}

// A dialogue whose spokenAt won't parse is dropped rather than filed under an invented date.
function datedInstants(dialogues: readonly Dialogue[]): number[] {
  return dialogues.flatMap((dialogue) => {
    const at = Date.parse(dialogue.spokenAt)
    return Number.isNaN(at) ? [] : [at]
  })
}

// A unit nothing was said in gets no bucket — otherwise a chart could spend a slot, a label and
// a focus stop on an empty hour. Boundaries are local-time calendar boundaries, so a "day" is
// 23 or 25 hours across a DST change, matching what its axis label claims.
export function bucketDialogues(
  dialogues: readonly Dialogue[],
  unit: BucketUnit,
): TimeBucket[] {
  // flatMap preserves order, so the already-ascending cached order needs no re-sort here.
  const dated = dialoguesByTimeAsc(dialogues).flatMap((dialogue) => {
    const at = Date.parse(dialogue.spokenAt)
    return Number.isNaN(at) ? [] : [{ dialogue, at }]
  })

  // dated is sorted, so a bucket is only ever extended while it's the last one — one pass.
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

// Component arithmetic, so DST and month lengths take care of themselves.
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

// Built once per unit, not per tick — a formatter is expensive to construct.
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

export function describeBucket(bucket: TimeBucket, unit: BucketUnit): string {
  return `${BUCKET_UNIT_NOUN[unit]} of ${formatBucketStart(bucket.start, unit)}`
}

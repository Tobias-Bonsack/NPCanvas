import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { Dialogue, DialogueId, Zone, ZoneId } from '../project/types.ts'
import { DialogueRow } from './DialogueRow.tsx'
import { SegmentDefs } from './SegmentLegend.tsx'
import { resolveZones } from './dialogue-summary.ts'
import type { DialogueFilter } from './filters.ts'
import type { SegmentKey } from './relevance-segments.ts'
import { SEGMENT_COLOR, SEGMENT_KEYS, tallyOf, totalOf } from './relevance-segments.ts'
import type { BucketUnit, TimeBucket } from './timeline-buckets.ts'
import { bucketDialogues, describeBucket, formatBucketStart } from './timeline-buckets.ts'

// viewBox units, scaled by the browser — the svg is width:100% / height:auto.
const WIDTH = 720
const PLOT_X = 30
const PLOT_WIDTH = WIDTH - PLOT_X - 8
const PLOT_TOP = 10
const PLOT_HEIGHT = 120
const AXIS_Y = PLOT_TOP + PLOT_HEIGHT
const HEIGHT = AXIS_Y + 22
/** Roughly this many axis labels, whatever the bucket count — more and they collide. */
const AXIS_TICKS = 8
/** A bar never grows past this, however few buckets there are. */
const MAX_BAR_WIDTH = 40

/** A brush in progress. Both ends are bucket indices, and `from` may be after `to`. */
type Brush = { from: number; to: number }

/**
 * The collection along the time axis: when each thing was heard, where the dense sessions are,
 * and what was going on during one.
 *
 * The dialogues handed in are filtered by *everything except the date range*. That is what makes
 * brushing work like a brush: selecting a fortnight highlights it in place instead of re-scaling
 * the axis to the fortnight and leaving nothing to drag back out of.
 */
export function Timeline({
  dialogues,
  zonesById,
  zoneIndex,
  filter,
  onChange,
  active,
  onActiveChange,
}: {
  dialogues: readonly Dialogue[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  filter: DialogueFilter
  onChange: (filter: DialogueFilter) => void
  /** The open bucket's index — lifted to `App` so it survives a switch away and back. */
  active: number | null
  onActiveChange: (active: number | null) => void
}): ReactElement {
  const { unit, buckets } = useMemo(() => bucketDialogues(dialogues), [dialogues])
  // A brush in flight cannot outlive the pointer gesture that draws it, so unlike `active` it
  // stays local — there is nothing to restore across a view switch.
  const [brush, setBrush] = useState<Brush | null>(null)

  const hasRange = filter.from !== null || filter.to !== null

  function clearRange(): void {
    onChange({ ...filter, from: null, to: null })
  }

  if (buckets.length === 0) {
    return (
      <TimelinePanel unit={unit} hasRange={hasRange} onClearRange={clearRange}>
        <p className="insights__empty">
          {/* Two ways to have no axis, and they call for different fixes: widen the filter, or
              go and repair a spokenAt that will not parse. */}
          {dialogues.length === 0
            ? 'Nothing to place on a timeline — no dialogue matches the filter.'
            : 'Nothing to place on a timeline — no dialogue here carries a readable date.'}
        </p>
      </TimelinePanel>
    )
  }

  // A bucket's height is its tag occurrences, exactly as the breakdown's bars are, so the two
  // panels are the same measurement seen along two different axes.
  const tallies = buckets.map((bucket) => tallyOf(bucket.dialogues))
  const tallest = tallies.reduce((max, each) => Math.max(max, totalOf(each.counts)), 0)
  const scale = tallest === 0 ? 0 : PLOT_HEIGHT / tallest
  const slot = PLOT_WIDTH / buckets.length
  const from = filter.from === null ? null : Date.parse(filter.from)
  const to = filter.to === null ? null : Date.parse(filter.to)
  const brushed =
    brush === null
      ? null
      : { lo: Math.min(brush.from, brush.to), hi: Math.max(brush.from, brush.to) }

  function indexAt(event: ReactPointerEvent<SVGRectElement>): number {
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientX - box.left) / box.width
    const index = Math.floor(fraction * buckets.length)
    return Math.min(Math.max(index, 0), buckets.length - 1)
  }

  function commit(range: Brush): void {
    const lo = buckets[Math.min(range.from, range.to)]
    const hi = buckets[Math.max(range.from, range.to)]
    // The bucket's end is exclusive and the filter's bound is inclusive, so the range stops one
    // millisecond short of the next bucket rather than swallowing its first line.
    onChange({
      ...filter,
      from: new Date(lo.start).toISOString(),
      to: new Date(hi.end - 1).toISOString(),
    })
  }

  const activeBucket = active === null ? null : buckets[active]

  return (
    <TimelinePanel unit={unit} hasRange={hasRange} onClearRange={clearRange}>
      <svg
        className="insights__svg timeline__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Dialogues per ${unit}`}
      >
        <SegmentDefs idPrefix="timeline" />

        <text className="insights__row-label" x={PLOT_X - 6} y={PLOT_TOP + 4} textAnchor="end">
          {tallest}
        </text>
        <text className="insights__row-label" x={PLOT_X - 6} y={AXIS_Y} textAnchor="end">
          0
        </text>
        <line
          className="timeline__axis"
          x1={PLOT_X}
          y1={AXIS_Y}
          x2={PLOT_X + PLOT_WIDTH}
          y2={AXIS_Y}
        />

        {brushed !== null && (
          <rect
            className="timeline__brush"
            x={PLOT_X + brushed.lo * slot}
            y={PLOT_TOP}
            width={(brushed.hi - brushed.lo + 1) * slot}
            height={PLOT_HEIGHT}
          />
        )}

        {buckets.map((bucket, index) => (
          <TimelineBar
            key={bucket.start}
            bucket={bucket}
            unit={unit}
            counts={tallies[index].counts}
            x={PLOT_X + index * slot}
            width={slot}
            scale={scale}
            outside={hasRange && !intersectsRange(bucket, from, to)}
            onOpen={() => onActiveChange(index)}
          />
        ))}

        {axisTicks(buckets.length).map((index) => (
          <text
            key={index}
            className="timeline__tick"
            x={PLOT_X + index * slot + slot / 2}
            y={AXIS_Y + 14}
            textAnchor="middle"
          >
            {formatBucketStart(buckets[index].start, unit)}
          </text>
        ))}

        {/* One surface over the whole plot handles hover and brushing: the bars underneath take
            no pointer events, so a one-pixel bar is still as easy to hit as a wide one. */}
        <rect
          className="timeline__surface"
          x={PLOT_X}
          y={PLOT_TOP}
          width={PLOT_WIDTH}
          height={PLOT_HEIGHT}
          onPointerDown={(event) => {
            const index = indexAt(event)
            event.currentTarget.setPointerCapture(event.pointerId)
            setBrush({ from: index, to: index })
            onActiveChange(index)
          }}
          onPointerMove={(event) => {
            const index = indexAt(event)
            // `onActiveChange` writes into the lifted view state as a whole new object every
            // call — see `InsightsScreen`'s `setTimelineActive` — so calling it unconditionally
            // on every pointermove re-renders the detail pane, and re-announces its live region,
            // for every pixel crossed inside the bucket already open.
            if (index !== active) onActiveChange(index)
            setBrush((current) => (current === null ? null : { ...current, to: index }))
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId)
            if (brush !== null) commit(brush)
            setBrush(null)
          }}
          onPointerLeave={() => {
            if (brush === null) onActiveChange(null)
          }}
        />
      </svg>

      <BucketDetail
        bucket={activeBucket ?? null}
        unit={unit}
        zonesById={zonesById}
        zoneIndex={zoneIndex}
      />
    </TimelinePanel>
  )
}

const UNIT_NOTE: Record<BucketUnit, string> = {
  hour: 'One bar per hour.',
  day: 'One bar per day.',
  week: 'One bar per week, starting Monday.',
  month: 'One bar per month.',
}

/** The frame, so the empty state and the chart carry the same heading and the same control. */
function TimelinePanel({
  unit,
  hasRange,
  onClearRange,
  children,
}: {
  unit: BucketUnit
  hasRange: boolean
  onClearRange: () => void
  children: ReactNode
}): ReactElement {
  return (
    <section className="insights__panel" aria-label="Timeline">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Timeline</h2>
        <p className="insights__panel-note">
          {UNIT_NOTE[unit]} Drag across the bars to filter to that stretch of time; hover or focus
          one to see what was said.
        </p>
        <button
          type="button"
          className="filter-bar__clear"
          disabled={!hasRange}
          onClick={onClearRange}
        >
          Clear range
        </button>
      </header>
      {children}
    </section>
  )
}

function TimelineBar({
  bucket,
  unit,
  counts,
  x,
  width,
  scale,
  outside,
  onOpen,
}: {
  bucket: TimeBucket
  unit: BucketUnit
  counts: Record<SegmentKey, number>
  x: number
  width: number
  scale: number
  outside: boolean
  onOpen: () => void
}): ReactElement {
  // A gap only where there is room for one; below that the bars merge into a continuous band,
  // which is the honest reading of "more buckets than pixels". Capped and centred in its slot at
  // the other end: one lonely bucket stretched across the whole plot reads as a solid backdrop
  // rather than as a single measurement.
  const barWidth = Math.min(Math.max(width - (width > 4 ? 1.5 : 0), 0.5), MAX_BAR_WIDTH)
  const left = x + (width - barWidth) / 2
  const label = `${describeBucket(bucket, unit)}: ${bucket.dialogues.length}`
  let y = PLOT_TOP + PLOT_HEIGHT

  return (
    <g
      className="timeline__bucket"
      data-outside={outside ? '' : undefined}
      role="button"
      tabIndex={0}
      aria-label={label}
      onFocus={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
    >
      <title>{label}</title>
      {SEGMENT_KEYS.map((segment) => {
        const count = counts[segment]
        if (count === 0) return null
        const height = count * scale
        y -= height
        return (
          <g key={segment}>
            <rect x={left} y={y} width={barWidth} height={height} fill={SEGMENT_COLOR[segment]} />
            <rect
              x={left}
              y={y}
              width={barWidth}
              height={height}
              fill={`url(#timeline-${segment})`}
            />
          </g>
        )
      })}
      {/* An empty bucket still needs something to focus and hover, or a gap would be a hole in
          the keyboard order as well as in the chart. */}
      {bucket.dialogues.length === 0 && (
        <rect
          className="timeline__empty-bucket"
          x={left}
          y={PLOT_TOP + PLOT_HEIGHT - 1}
          width={barWidth}
          height={1}
        />
      )}
    </g>
  )
}

/** How many lines one bucket lists before it stops listing and starts counting. */
const DETAIL_LIMIT = 12

function BucketDetail({
  bucket,
  unit,
  zonesById,
  zoneIndex,
}: {
  bucket: TimeBucket | null
  unit: BucketUnit
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
}): ReactElement {
  if (bucket === null) {
    return <p className="insights__empty">Hover or focus a bar to see the lines it holds.</p>
  }

  return (
    <div className="timeline__detail">
      <h3 className="timeline__detail-title">
        {capitalize(describeBucket(bucket, unit))}
        <span className="quest-board__count">{bucket.dialogues.length}</span>
      </h3>
      {/* Polite, not assertive, and a one-line summary rather than the rows below: an assertive
          region would interrupt a screen reader mid-sentence, and reading out up to twelve full
          dialogue rows on every bucket change is not what "announce what changed" means. */}
      <p className="visually-hidden" aria-live="polite">
        {bucket.dialogues.length} {bucket.dialogues.length === 1 ? 'dialogue' : 'dialogues'} in{' '}
        {describeBucket(bucket, unit)}
      </p>
      {bucket.dialogues.length === 0 ? (
        <p className="insights__empty">Nothing was logged in this one.</p>
      ) : (
        <ul className="insights__rows">
          {bucket.dialogues.slice(0, DETAIL_LIMIT).map((dialogue) => (
            <li key={dialogue.id}>
              <DialogueRow
                dialogue={dialogue}
                zones={resolveZones(dialogue.id, zoneIndex, zonesById)}
              />
            </li>
          ))}
        </ul>
      )}
      {bucket.dialogues.length > DETAIL_LIMIT && (
        <p className="insights__empty">
          …and {bucket.dialogues.length - DETAIL_LIMIT} more in this {unit}.
        </p>
      )}
    </div>
  )
}

/** A bucket is in range if any part of it is: a range that cuts a bucket still selected it. */
function intersectsRange(bucket: TimeBucket, from: number | null, to: number | null): boolean {
  if (from !== null && !Number.isNaN(from) && bucket.end <= from) return false
  if (to !== null && !Number.isNaN(to) && bucket.start > to) return false
  return true
}

/** Evenly spaced tick indices, always including the first bucket. */
function axisTicks(count: number): number[] {
  const step = Math.max(1, Math.ceil(count / AXIS_TICKS))
  const indices: number[] = []
  for (let index = 0; index < count; index += step) indices.push(index)
  return indices
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

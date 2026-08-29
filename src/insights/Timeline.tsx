import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { useChartWidth } from './chart-width.ts'
import { DialogueRow } from '../dialogue-row/DialogueRow.tsx'
import { resolveZones } from '../dialogue-row/dialogue-summary.ts'
import type { Dialogue, DialogueId, RelevanceTag, Zone, ZoneId } from '../project/types.ts'
import { SegmentDefs } from './SegmentLegend.tsx'
import type { DialogueFilter } from './filters.ts'
import type { SegmentKey } from './relevance-segments.ts'
import { segmentColor, segmentKeys, tallyOf, totalOf } from './relevance-segments.ts'
import type { BucketUnit, TimeBucket } from './timeline-buckets.ts'
import {
  BUCKET_UNITS,
  autoBucketUnit,
  bucketDialogues,
  describeBucket,
  formatBucketStart,
} from './timeline-buckets.ts'

// viewBox units — and, since `useChartWidth` feeds the svg's own measured width back in as its
// viewBox width, one viewBox unit *is* one real CSS pixel. See the comment on `chart-width.ts`.
const DEFAULT_WIDTH = 720
const PLOT_X = 30
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
  relevanceTags,
  filter,
  onChange,
  active,
  onActiveChange,
  unit,
  onUnitChange,
}: {
  dialogues: readonly Dialogue[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  relevanceTags: readonly RelevanceTag[]
  filter: DialogueFilter
  onChange: (filter: DialogueFilter) => void
  /**
   * The open bucket's `start` instant, not an index — lifted to `App` so it survives a switch
   * away and back. Keyed on the instant rather than a position in `buckets` because that array
   * is rebuilt from `dialogues` on every filter change other than the date range (see the note
   * above): an index surviving that rebuild would silently point at a different bucket than the
   * one the user actually opened.
   */
  active: number | null
  onActiveChange: (active: number | null) => void
  /** The grain to read the axis at; `null` is Auto, which `autoBucketUnit` answers. */
  unit: BucketUnit | null
  onUnitChange: (unit: BucketUnit | null) => void
}): ReactElement {
  const [svgRef, width] = useChartWidth<SVGSVGElement>(DEFAULT_WIDTH)
  const derived = useMemo(() => autoBucketUnit(dialogues), [dialogues])
  // Everything below — the buckets, the captions, the labels, the accessible names — reads the
  // *resolved* unit, so the picker and the axis can never describe different things.
  const resolvedUnit = unit ?? derived
  const buckets = useMemo(
    () => bucketDialogues(dialogues, resolvedUnit),
    [dialogues, resolvedUnit],
  )
  const segmentKeysList = useMemo(() => segmentKeys(relevanceTags), [relevanceTags])
  const colors = useMemo(() => segmentColor(relevanceTags), [relevanceTags])
  // A brush in flight cannot outlive the pointer gesture that draws it, so unlike `active` it
  // stays local — there is nothing to restore across a view switch.
  const [brush, setBrush] = useState<Brush | null>(null)
  // A keyboard-drawn range in progress — the Shift+arrow equivalent of `brush`. Also local: it
  // is exactly as ephemeral, just built one bucket at a time instead of one pointermove at a
  // time. `null` means no range is being built, whether or not a bucket is merely focused.
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null)

  const plotWidth = Math.max(width - PLOT_X - 8, 0)
  const hasRange = filter.from !== null || filter.to !== null
  const activeIndex = active === null ? -1 : buckets.findIndex((bucket) => bucket.start === active)
  // Tab reaches exactly one bucket — whichever is open, or the first if none is yet. Moving the
  // roving position (below) is what "focus follows the active bucket" already gets for free.
  const rovingIndex = activeIndex === -1 ? 0 : activeIndex

  function clearRange(): void {
    onChange({ ...filter, from: null, to: null })
  }

  // Escape aborts a pointer-drawn brush in progress. Bound while brushing rather than always,
  // and keyed on whether a brush exists rather than the brush itself, so this does not
  // resubscribe on every pointermove of the drag it is watching for the end of.
  const brushing = brush !== null
  useEffect(() => {
    if (!brushing) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setBrush(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [brushing])

  if (buckets.length === 0) {
    return (
      <TimelinePanel
        unit={resolvedUnit}
        selected={unit}
        derived={derived}
        onUnitChange={onUnitChange}
        hasRange={hasRange}
        onClearRange={clearRange}
      >
        <p className="insights__empty hint-text">
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
  // panels are the same measurement seen along two different axes — and every label below says
  // so, rather than mixing in a count of *dialogues*, which a doubly tagged line would disagree
  // with.
  const tallies = buckets.map((bucket) => tallyOf(bucket.dialogues, relevanceTags))
  const tallest = tallies.reduce((max, each) => Math.max(max, totalOf(each.counts)), 0)
  const scale = tallest === 0 ? 0 : PLOT_HEIGHT / tallest
  const slot = plotWidth / buckets.length
  const from = filter.from === null ? null : Date.parse(filter.from)
  const to = filter.to === null ? null : Date.parse(filter.to)
  // The pointer brush and a keyboard-drawn range are the same kind of thing to draw — whichever
  // is in progress (never both) is what the highlight rect below shows.
  const keyboardRange: Brush | null =
    rangeAnchor === null ? null : { from: rangeAnchor, to: rovingIndex }
  const visibleBrush = brush ?? keyboardRange
  const brushed =
    visibleBrush === null
      ? null
      : { lo: Math.min(visibleBrush.from, visibleBrush.to), hi: Math.max(visibleBrush.from, visibleBrush.to) }

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

  function onBucketKeyDown(event: ReactKeyboardEvent<SVGGElement>, index: number): void {
    if (event.key === 'Escape' && rangeAnchor !== null) {
      event.stopPropagation()
      setRangeAnchor(null)
      return
    }
    const step = arrowStep(event.key)
    if (step !== null) {
      event.preventDefault()
      const next = Math.min(Math.max(index + step, 0), buckets.length - 1)
      setRangeAnchor(event.shiftKey ? (rangeAnchor ?? index) : null)
      onActiveChange(buckets[next].start)
      document.getElementById(bucketElementId(buckets[next]))?.focus()
      return
    }
    if (event.key === 'Enter' && rangeAnchor !== null) {
      event.preventDefault()
      commit({ from: rangeAnchor, to: index })
      setRangeAnchor(null)
    }
  }

  const activeBucket = activeIndex === -1 ? null : buckets[activeIndex]

  return (
    <TimelinePanel
        unit={resolvedUnit}
        selected={unit}
        derived={derived}
        onUnitChange={onUnitChange}
        hasRange={hasRange}
        onClearRange={clearRange}
      >
      <svg
        ref={svgRef}
        className="insights__svg timeline__svg"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Tag occurrences per ${resolvedUnit}`}
      >
        <SegmentDefs idPrefix="timeline" tags={relevanceTags} />

        <text className="insights__row-label" x={PLOT_X - 6} y={PLOT_TOP + 4} textAnchor="end">
          {tallest}
        </text>
        <text className="insights__row-label" x={PLOT_X - 6} y={AXIS_Y} textAnchor="end">
          0
        </text>
        <line className="timeline__axis" x1={PLOT_X} y1={AXIS_Y} x2={PLOT_X + plotWidth} y2={AXIS_Y} />

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
            unit={resolvedUnit}
            counts={tallies[index].counts}
            keys={segmentKeysList}
            colors={colors}
            x={PLOT_X + index * slot}
            width={slot}
            scale={scale}
            outside={hasRange && !intersectsRange(bucket, from, to)}
            roving={index === rovingIndex}
            onOpen={() => onActiveChange(bucket.start)}
            onKeyDown={(event) => onBucketKeyDown(event, index)}
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
            {formatBucketStart(buckets[index].start, resolvedUnit)}
          </text>
        ))}

        {/* One surface over the whole plot handles hover and brushing: the bars underneath take
            no pointer events, so a one-pixel bar is still as easy to hit as a wide one. */}
        <rect
          className="timeline__surface"
          x={PLOT_X}
          y={PLOT_TOP}
          width={plotWidth}
          height={PLOT_HEIGHT}
          onPointerDown={(event) => {
            const index = indexAt(event)
            event.currentTarget.setPointerCapture(event.pointerId)
            setBrush({ from: index, to: index })
            onActiveChange(buckets[index].start)
          }}
          onPointerMove={(event) => {
            const index = indexAt(event)
            // `onActiveChange` writes into the lifted view state as a whole new object every
            // call — see `InsightsScreen`'s `setTimelineActive` — so calling it unconditionally
            // on every pointermove re-renders the detail pane, and re-announces its live region,
            // for every pixel crossed inside the bucket already open.
            if (buckets[index].start !== active) onActiveChange(buckets[index].start)
            setBrush((current) => (current === null ? null : { ...current, to: index }))
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId)
            // A press and release with no movement is a click — it has already inspected the
            // bucket above, through the same `onActiveChange` a hover would trigger, and must
            // not *also* narrow the date filter. Only an actual drag, spanning more than one
            // bucket, commits a range.
            if (brush !== null && brush.from !== brush.to) commit(brush)
            setBrush(null)
          }}
          onPointerLeave={() => {
            if (brush === null) onActiveChange(null)
          }}
        />
      </svg>

      <BucketDetail
        bucket={activeBucket}
        unit={resolvedUnit}
        zonesById={zonesById}
        zoneIndex={zoneIndex}
      />
    </TimelinePanel>
  )
}

const UNIT_NOTE: Record<BucketUnit, string> = {
  hour: 'One bar per hour that holds something.',
  day: 'One bar per day that holds something.',
  week: 'One bar per week that holds something, starting Monday.',
  month: 'One bar per month that holds something.',
}

/** The frame, so the empty state and the chart carry the same heading and the same controls. */
function TimelinePanel({
  unit,
  selected,
  derived,
  onUnitChange,
  hasRange,
  onClearRange,
  children,
}: {
  /** The grain actually drawn — `selected`, or `derived` when that is Auto. */
  unit: BucketUnit
  selected: BucketUnit | null
  derived: BucketUnit
  onUnitChange: (unit: BucketUnit | null) => void
  hasRange: boolean
  onClearRange: () => void
  children: ReactNode
}): ReactElement {
  return (
    <section className="insights__panel card" aria-label="Timeline">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Timeline</h2>
        <p className="insights__panel-note hint-text">{UNIT_NOTE[unit]}</p>
        <Disclosure>
          <p>
            A stretch nothing was said in gets no bar at all, so the bars sit side by side
            however far apart in time they are. A bar's height is tag occurrences, so a doubly
            tagged line counts twice — exactly as in the Relevance panel below. Click a bar to
            inspect it; drag across several, or focus one and press Shift+arrow then Enter, to
            filter to that stretch of time.
          </p>
        </Disclosure>
        <GrainPicker selected={selected} derived={derived} onChange={onUnitChange} />
        <button type="button" className="button" disabled={!hasRange} onClick={onClearRange}>
          Clear range
        </button>
      </header>
      {children}
    </section>
  )
}

const GRAIN_LABEL: Record<BucketUnit, string> = {
  hour: 'Hour',
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

/** `null` first, then the ladder — the order the buttons sit in and the arrows travel. */
const GRAIN_OPTIONS: readonly (BucketUnit | null)[] = [null, ...BUCKET_UNITS]

/**
 * The grain is the reader's to choose: comparing two evenings wants hours and comparing two
 * months wants months, from the same lines, and no derivation from the data answers both.
 *
 * A mutually exclusive set, so `radiogroup`/`radio` and a roving tabindex — the same shape as
 * `MapScreen`'s `ToolPicker`, and for the same reason: Tab lands once, on whichever is checked,
 * and the arrows move selection and focus together.
 */
function GrainPicker({
  selected,
  derived,
  onChange,
}: {
  selected: BucketUnit | null
  derived: BucketUnit
  onChange: (unit: BucketUnit | null) => void
}): ReactElement {
  const buttons = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    const step = arrowStep(event.key)
    if (step === null) return
    event.preventDefault()
    const next = GRAIN_OPTIONS[(index + step + GRAIN_OPTIONS.length) % GRAIN_OPTIONS.length]
    onChange(next)
    buttons.current[grainKey(next)]?.focus()
  }

  return (
    <div className="grain-picker" role="radiogroup" aria-label="Timeline grain">
      {GRAIN_OPTIONS.map((option, index) => (
        <button
          key={grainKey(option)}
          ref={(element) => {
            buttons.current[grainKey(option)] = element
          }}
          type="button"
          role="radio"
          className="grain-picker__button segmented-button"
          aria-checked={option === selected}
          tabIndex={option === selected ? 0 : -1}
          // Auto names the unit it currently resolves to, so the control and the axis below can
          // never be read as claiming different grains.
          aria-label={option === null ? `Auto — currently ${derived}` : undefined}
          onClick={() => onChange(option)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option === null ? 'Auto' : GRAIN_LABEL[option]}
        </button>
      ))}
    </div>
  )
}

function grainKey(unit: BucketUnit | null): string {
  return unit ?? 'auto'
}

function TimelineBar({
  bucket,
  unit,
  counts,
  keys,
  colors,
  x,
  width,
  scale,
  outside,
  roving,
  onOpen,
  onKeyDown,
}: {
  bucket: TimeBucket
  unit: BucketUnit
  counts: Map<SegmentKey, number>
  keys: readonly SegmentKey[]
  colors: ReadonlyMap<SegmentKey, string>
  x: number
  width: number
  scale: number
  outside: boolean
  /** Whether this is the one bucket Tab reaches — see `rovingIndex`. */
  roving: boolean
  onOpen: () => void
  onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => void
}): ReactElement {
  // A gap only where there is room for one; below that the bars merge into a continuous band,
  // which is the honest reading of "more buckets than pixels". Capped and centred in its slot at
  // the other end: one lonely bucket stretched across the whole plot reads as a solid backdrop
  // rather than as a single measurement.
  const barWidth = Math.min(Math.max(width - (width > 4 ? 1.5 : 0), 0.5), MAX_BAR_WIDTH)
  const left = x + (width - barWidth) / 2
  const label = `${describeBucket(bucket, unit)}: ${totalOf(counts)}`
  let y = PLOT_TOP + PLOT_HEIGHT

  return (
    <g
      id={bucketElementId(bucket)}
      className="timeline__bucket"
      data-outside={outside ? '' : undefined}
      role="button"
      // One tab stop for the whole set of buckets — see `rovingIndex` — with the arrow keys
      // moving both the roving position and the visible focus together, the same pattern
      // `MapScreen`'s `ToolPicker` uses for its radiogroup.
      tabIndex={roving ? 0 : -1}
      onFocus={onOpen}
      onKeyDown={onKeyDown}
    >
      {/* The sole source of this bucket's accessible name — see the identical note in
          RelevanceBreakdown.tsx. An `aria-label` here would have said the same thing twice. */}
      <title>{label}</title>
      {keys.map((segment) => {
        const count = counts.get(segment) ?? 0
        if (count === 0) return null
        const height = count * scale
        y -= height
        return (
          <g key={segment}>
            <rect
              x={left}
              y={y}
              width={barWidth}
              height={height}
              fill={colors.get(segment) ?? 'transparent'}
            />
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
    return <p className="insights__empty hint-text">Hover or focus a bar to see the lines it holds.</p>
  }

  return (
    <div className="timeline__detail">
      <h3 className="timeline__detail-title micro-label">
        {capitalize(describeBucket(bucket, unit))}
        <span className="count-pill">{bucket.dialogues.length}</span>
      </h3>
      {/* Polite, not assertive, and a one-line summary rather than the rows below: an assertive
          region would interrupt a screen reader mid-sentence, and reading out up to twelve full
          dialogue rows on every bucket change is not what "announce what changed" means. */}
      <p className="visually-hidden" aria-live="polite">
        {bucket.dialogues.length} {bucket.dialogues.length === 1 ? 'dialogue' : 'dialogues'} in{' '}
        {describeBucket(bucket, unit)}
      </p>
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
      {bucket.dialogues.length > DETAIL_LIMIT && (
        <p className="insights__empty hint-text">
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

/** `ArrowRight` moves forward, `ArrowLeft` back; anything else is `null` — see `MapScreen`'s
 *  near-identical `arrowStep` for the tool picker's radiogroup. Shared here by the bars and the
 *  grain picker. Up/Down are left alone: both are one-dimensional rows, and claiming the vertical
 *  arrows would fight the page's own scrolling. */
function arrowStep(key: string): number | null {
  if (key === 'ArrowRight') return 1
  if (key === 'ArrowLeft') return -1
  return null
}

/** The DOM id a bucket's `<g>` is found by when an arrow key moves the roving focus onto it. */
function bucketElementId(bucket: TimeBucket): string {
  return `timeline-bucket-${bucket.start}`
}

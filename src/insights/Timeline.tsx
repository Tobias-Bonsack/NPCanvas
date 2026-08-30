import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { useChartWidth } from './chart-width.ts'
import { DialogueRow } from '../dialogue-row/DialogueRow.tsx'
import { resolveZones } from '../dialogue-row/dialogue-summary.ts'
import type { Dialogue, DialogueId, RelevanceTag, Zone, ZoneId } from '../project/types.ts'
import { SegmentDefs, SegmentFill, UNKNOWN_FILL } from './SegmentLegend.tsx'
import type { DialogueFilter } from './filters.ts'
import type { SegmentKey } from './relevance-segments.ts'
import { segmentColor, segmentKeys, segmentRun, tallyOf, totalOf } from './relevance-segments.ts'
import type { BucketUnit, TimeBucket } from './timeline-buckets.ts'
import {
  BUCKET_UNITS,
  autoBucketUnit,
  bucketDialogues,
  describeBucket,
  formatBucketStart,
} from './timeline-buckets.ts'

// viewBox units, and (per chart-width.ts) one viewBox unit is one real CSS pixel.
const DEFAULT_WIDTH = 720
const PLOT_X = 30
const PLOT_TOP = 10
const PLOT_HEIGHT = 120
const AXIS_Y = PLOT_TOP + PLOT_HEIGHT
const HEIGHT = AXIS_Y + 22
const AXIS_TICKS = 8
const MAX_BAR_WIDTH = 40

type Brush = { from: number; to: number }

// `dialogues` is filtered by everything except the date range, so brushing highlights a
// selection in place instead of re-scaling the axis to it.
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
  // The open bucket's start instant, not an index — buckets rebuilds on most filter changes.
  active: number | null
  onActiveChange: (active: number | null) => void
  unit: BucketUnit | null
  onUnitChange: (unit: BucketUnit | null) => void
}): ReactElement {
  const [svgRef, width] = useChartWidth<SVGSVGElement>(DEFAULT_WIDTH)
  const derived = useMemo(() => autoBucketUnit(dialogues), [dialogues])
  const resolvedUnit = unit ?? derived
  const buckets = useMemo(
    () => bucketDialogues(dialogues, resolvedUnit),
    [dialogues, resolvedUnit],
  )
  const segmentKeysList = useMemo(() => segmentKeys(relevanceTags), [relevanceTags])
  const colors = useMemo(() => segmentColor(relevanceTags), [relevanceTags])
  // Local, not lifted like `active` — a brush can't outlive the pointer gesture that draws it.
  const [brush, setBrush] = useState<Brush | null>(null)
  // A keyboard-drawn range in progress (Shift+arrow); null means no range is being built.
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null)

  const plotWidth = Math.max(width - PLOT_X - 8, 0)
  const hasRange = filter.from !== null || filter.to !== null
  const activeIndex = active === null ? -1 : buckets.findIndex((bucket) => bucket.start === active)
  const rovingIndex = activeIndex === -1 ? 0 : activeIndex

  function clearRange(): void {
    onChange({ ...filter, from: null, to: null })
  }

  // Keyed on whether a brush exists, not the brush itself, so this doesn't resubscribe per move.
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
          {dialogues.length === 0
            ? 'Nothing to place on a timeline — no dialogue matches the filter.'
            : 'Nothing to place on a timeline — no dialogue here carries a readable date.'}
        </p>
      </TimelinePanel>
    )
  }

  // A bucket's height is tag occurrences (as in the breakdown panel below), not dialogue count,
  // since a doubly tagged line would disagree with the latter.
  const tallies = buckets.map((bucket) => tallyOf(bucket.dialogues, relevanceTags))
  const tallest = tallies.reduce((max, each) => Math.max(max, totalOf(each.counts)), 0)
  const scale = tallest === 0 ? 0 : PLOT_HEIGHT / tallest
  const slot = plotWidth / buckets.length
  const from = filter.from === null ? null : Date.parse(filter.from)
  const to = filter.to === null ? null : Date.parse(filter.to)
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
    // The bucket's end is exclusive, the filter's bound inclusive — stop one ms short.
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
            // Skips redundant onActiveChange calls, which would otherwise re-render the detail
            // pane and re-announce its live region on every pixel crossed.
            if (buckets[index].start !== active) onActiveChange(buckets[index].start)
            setBrush((current) => (current === null ? null : { ...current, to: index }))
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId)
            // A click (no movement) already inspected the bucket via onActiveChange and must
            // not also narrow the date filter — only an actual multi-bucket drag commits.
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

const GRAIN_OPTIONS: readonly (BucketUnit | null)[] = [null, ...BUCKET_UNITS]

// radiogroup/radio with a roving tabindex, as in MapScreen's ToolPicker: Tab lands once, on
// whichever is checked, and the arrows move selection and focus together.
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
  roving: boolean
  onOpen: () => void
  onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => void
}): ReactElement {
  // No gap when there's no room for one (bars merge into a band); capped at the other end so a
  // lonely bucket doesn't stretch across the whole plot as a solid backdrop.
  const barWidth = Math.min(Math.max(width - (width > 4 ? 1.5 : 0), 0.5), MAX_BAR_WIDTH)
  const left = x + (width - barWidth) / 2
  const label = `${describeBucket(bucket, unit)}: ${totalOf(counts)}`
  const bottom = PLOT_TOP + PLOT_HEIGHT

  return (
    <g
      id={bucketElementId(bucket)}
      className="timeline__bucket"
      data-outside={outside ? '' : undefined}
      role="button"
      tabIndex={roving ? 0 : -1}
      onFocus={onOpen}
      onKeyDown={onKeyDown}
    >
      <title>{label}</title>
      {segmentRun(keys, counts, scale).map(({ segment, offset, extent }) => (
        <SegmentFill
          key={segment}
          idPrefix="timeline"
          segment={segment}
          color={colors.get(segment) ?? UNKNOWN_FILL}
          rect={{ x: left, y: bottom - offset - extent, width: barWidth, height: extent }}
        />
      ))}
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
      <p className="visually-hidden" aria-live="polite">
        {bucket.dialogues.length} {bucket.dialogues.length === 1 ? 'dialogue' : 'dialogues'} in{' '}
        {describeBucket(bucket, unit)}
      </p>
      <ul className="framed-list insights__rows">
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

function intersectsRange(bucket: TimeBucket, from: number | null, to: number | null): boolean {
  if (from !== null && !Number.isNaN(from) && bucket.end <= from) return false
  if (to !== null && !Number.isNaN(to) && bucket.start > to) return false
  return true
}

function axisTicks(count: number): number[] {
  const step = Math.max(1, Math.ceil(count / AXIS_TICKS))
  const indices: number[] = []
  for (let index = 0; index < count; index += step) indices.push(index)
  return indices
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Up/Down deliberately unhandled — both rows are one-dimensional, and claiming vertical arrows
// would fight the page's own scrolling.
function arrowStep(key: string): number | null {
  if (key === 'ArrowRight') return 1
  if (key === 'ArrowLeft') return -1
  return null
}

function bucketElementId(bucket: TimeBucket): string {
  return `timeline-bucket-${bucket.start}`
}

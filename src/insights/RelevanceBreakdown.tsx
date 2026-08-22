import type { ReactElement } from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dialogue, DialogueId, Zone, ZoneId } from '../project/types.ts'
import { useChartWidth } from './chart-width.ts'
import type { DialogueFilter, ZoneScope } from './filters.ts'
import { NO_ZONE, npcKey, npcLabel } from './filters.ts'
import { SegmentDefs, SegmentLegend } from './SegmentLegend.tsx'
import type { SegmentKey, Tally } from './relevance-segments.ts'
import {
  SEGMENT_COLOR,
  SEGMENT_KEYS,
  SEGMENT_LABEL,
  emptyTally,
  tally,
  totalOf,
} from './relevance-segments.ts'

/** What clicking a row's segment narrows to — the row's own axis, whichever chart it is in. */
type RowTarget =
  | { kind: 'zones'; zones: readonly ZoneScope[] }
  | { kind: 'npcs'; npcKeys: readonly string[] }

type BreakdownRow = {
  key: string
  label: string
  /** Distinct dialogues, which is what the row is sorted and labelled by. */
  dialogues: number
  counts: Record<SegmentKey, number>
  target: RowTarget
}

/** Beyond this many NPCs the chart stops being readable, so the tail becomes one "Other" bar. */
const NPC_LIMIT = 15

/**
 * Where relevance actually lives: which regions and which people the tagged lines came from.
 *
 * Both charts read the *filtered* dialogues, so clicking a segment drills down rather than
 * showing a chart of something the rest of the screen is not looking at.
 */
export function RelevanceBreakdown({
  dialogues,
  zones,
  zoneIndex,
  filter,
  onChange,
}: {
  dialogues: readonly Dialogue[]
  zones: readonly Zone[]
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  filter: DialogueFilter
  onChange: (filter: DialogueFilter) => void
}): ReactElement {
  const byZone = useMemo(() => zoneRows(dialogues, zones, zoneIndex), [dialogues, zones, zoneIndex])
  const byNpc = useMemo(() => npcRows(dialogues), [dialogues])

  function select(target: RowTarget, segment: SegmentKey): void {
    const narrowed: DialogueFilter =
      target.kind === 'zones'
        ? { ...filter, zones: target.zones }
        : { ...filter, npcKeys: target.npcKeys }
    // "Untagged" cannot be expressed as a relevance value — an empty array means "no opinion",
    // not "no tags" — so that segment narrows the row axis only, and clears any tag filter.
    onChange({ ...narrowed, relevance: segment === 'untagged' ? [] : [segment] })
  }

  return (
    <section className="insights__panel" aria-label="Relevance breakdown">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Relevance</h2>
        <p className="insights__panel-note">
          A line counts once per tag it carries, so a doubly tagged line appears in both segments.
          Click a segment to filter.
        </p>
      </header>

      <SegmentLegend />

      <div className="insights__charts">
        <BreakdownChart idPrefix="zone" title="By zone" rows={byZone} onSelect={select} />
        <BreakdownChart idPrefix="npc" title="By NPC" rows={byNpc} onSelect={select} />
      </div>
    </section>
  )
}

// One coordinate system for both charts, in viewBox units — and, since `useChartWidth` feeds
// the SVG's own measured width back in as its viewBox width, one viewBox unit *is* one real
// CSS pixel: the scale factor a `width: 100%` svg would otherwise apply to its viewBox is
// pinned at 1, so `.insights__row-label`'s `font-size` paints at its literal size no matter how
// the two-column layout in InsightsScreen.css squeezes the container.
const DEFAULT_WIDTH = 720
const LABEL_WIDTH = 168
const TOTAL_WIDTH = 44
const GAP = 10
const BAR_X = LABEL_WIDTH + GAP
const ROW_HEIGHT = 22
const ROW_PITCH = 30
/** Below this a count label does not fit inside its segment and is left to the tooltip. */
const LABEL_MIN_SEGMENT = 24

function BreakdownChart({
  idPrefix,
  title,
  rows,
  onSelect,
}: {
  idPrefix: string
  title: string
  rows: readonly BreakdownRow[]
  onSelect: (target: RowTarget, segment: SegmentKey) => void
}): ReactElement {
  const [svgRef, width] = useChartWidth<SVGSVGElement>(DEFAULT_WIDTH)
  const height = Math.max(rows.length * ROW_PITCH, ROW_PITCH)
  const barWidth = Math.max(width - BAR_X - TOTAL_WIDTH - GAP, 0)
  // A single row must still fill the bar rather than being drawn as a sliver of an imagined
  // larger maximum, so the scale is the largest row, never a fixed ceiling.
  const widest = rows.reduce((max, row) => Math.max(max, totalOf(row.counts)), 0)

  return (
    <figure className="insights__chart">
      <figcaption className="insights__chart-title">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="insights__empty">No dialogues to break down.</p>
      ) : (
        <svg
          ref={svgRef}
          className="insights__svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
        >
          <SegmentDefs idPrefix={idPrefix} />
          {rows.map((row, index) => (
            <BreakdownBar
              key={row.key}
              idPrefix={idPrefix}
              row={row}
              y={index * ROW_PITCH}
              width={width}
              barWidth={barWidth}
              scale={widest === 0 ? 0 : barWidth / widest}
              onSelect={onSelect}
            />
          ))}
        </svg>
      )}
    </figure>
  )
}

function BreakdownBar({
  idPrefix,
  row,
  y,
  width,
  barWidth,
  scale,
  onSelect,
}: {
  idPrefix: string
  row: BreakdownRow
  y: number
  /** The chart's own measured width — where the row's total count is printed. */
  width: number
  barWidth: number
  scale: number
  onSelect: (target: RowTarget, segment: SegmentKey) => void
}): ReactElement {
  const middle = y + ROW_HEIGHT / 2
  let x = BAR_X

  return (
    <g>
      <ClippedLabel text={row.label} maxWidth={LABEL_WIDTH} x={LABEL_WIDTH} y={middle} />
      <rect className="insights__track" x={BAR_X} y={y} width={barWidth} height={ROW_HEIGHT} rx="3" />
      {SEGMENT_KEYS.map((segment) => {
        const count = row.counts[segment]
        if (count === 0) return null
        const segmentWidth = count * scale
        const left = x
        x += segmentWidth
        const label = `${row.label}, ${SEGMENT_LABEL[segment]}: ${count}`
        return (
          <g
            key={segment}
            className="insights__segment"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(row.target, segment)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect(row.target, segment)
            }}
          >
            {/* The sole source of the accessible name — an SVG `<title>` as the first child of a
                graphics element with an interactive role is enough on its own; pairing it with
                an identical `aria-label` was two copies of the same string to keep in sync for
                nothing, since `aria-label` would have won the name computation anyway. Kept
                specifically for the native hover tooltip, which nothing else here provides. */}
            <title>{label}</title>
            <rect
              x={left}
              y={y}
              width={segmentWidth}
              height={ROW_HEIGHT}
              fill={SEGMENT_COLOR[segment]}
            />
            <rect
              x={left}
              y={y}
              width={segmentWidth}
              height={ROW_HEIGHT}
              fill={`url(#${idPrefix}-${segment})`}
            />
            {segmentWidth >= LABEL_MIN_SEGMENT && (
              <text
                className="insights__segment-count"
                x={left + segmentWidth / 2}
                y={middle}
                textAnchor="middle"
              >
                {count}
              </text>
            )}
          </g>
        )
      })}
      <text className="insights__row-total" x={width} y={middle} textAnchor="end">
        {row.dialogues}
      </text>
    </g>
  )
}

/**
 * A row label clipped to fit `maxWidth`, by actually measuring the rendered glyphs
 * (`getComputedTextLength`) rather than guessing from a character count — a wide capital in a
 * fifteen-character name and fifteen narrow lowercase letters do not take the same room, and the
 * old `truncate(label, 26)` treated them identically. Renders the full text first and corrects
 * it in `useLayoutEffect`, before the browser paints, so nothing overflowing is ever visible.
 */
function ClippedLabel({
  text,
  maxWidth,
  x,
  y,
}: {
  text: string
  maxWidth: number
  x: number
  y: number
}): ReactElement {
  const ref = useRef<SVGTextElement>(null)
  const [display, setDisplay] = useState(text)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || text === '') {
      setDisplay(text)
      return
    }
    element.textContent = text
    if (element.getComputedTextLength() <= maxWidth) {
      setDisplay(text)
      return
    }
    // The longest prefix (plus an ellipsis) that still fits, found by measuring the real
    // rendered length rather than assuming a width per character.
    let fits = 0
    let doesNotFit = text.length
    while (fits < doesNotFit) {
      const mid = Math.ceil((fits + doesNotFit) / 2)
      element.textContent = `${text.slice(0, mid)}…`
      if (element.getComputedTextLength() <= maxWidth) fits = mid
      else doesNotFit = mid - 1
    }
    setDisplay(fits === 0 ? '…' : `${text.slice(0, fits)}…`)
  }, [text, maxWidth])

  return (
    <text ref={ref} className="insights__row-label" x={x} y={y} textAnchor="end">
      {display}
    </text>
  )
}

/** Every zone that holds a filtered dialogue, plus the lines that fall outside all of them. */
function zoneRows(
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
): BreakdownRow[] {
  const byZone = new Map<ZoneId, Tally>()
  const outside = emptyTally()

  for (const dialogue of dialogues) {
    const inside = zoneIndex.get(dialogue.id) ?? []
    if (inside.length === 0) {
      tally(outside, dialogue)
      continue
    }
    // A line in two overlapping zones counts in both, exactly as `countDialoguesByZone` does.
    for (const zoneId of inside) {
      const bucket = byZone.get(zoneId) ?? emptyTally()
      tally(bucket, dialogue)
      byZone.set(zoneId, bucket)
    }
  }

  const rows: BreakdownRow[] = []
  for (const zone of zones) {
    const bucket = byZone.get(zone.id)
    if (bucket === undefined) continue
    rows.push({
      key: zone.id,
      label: zone.name.trim() === '' ? 'Unnamed zone' : zone.name,
      dialogues: bucket.dialogues,
      counts: bucket.counts,
      target: { kind: 'zones', zones: [zone.id] },
    })
  }
  if (outside.dialogues > 0) {
    rows.push({
      key: NO_ZONE,
      label: 'Outside any zone',
      dialogues: outside.dialogues,
      counts: outside.counts,
      target: { kind: 'zones', zones: [NO_ZONE] },
    })
  }
  return sortByDialogues(rows)
}

/** NPCs by line count, with everything past `NPC_LIMIT` folded into one clickable "Other". */
function npcRows(dialogues: readonly Dialogue[]): BreakdownRow[] {
  const byNpc = new Map<string, Tally>()
  for (const dialogue of dialogues) {
    const key = npcKey(dialogue)
    const bucket = byNpc.get(key) ?? emptyTally()
    tally(bucket, dialogue)
    byNpc.set(key, bucket)
  }

  const rows = sortByDialogues(
    [...byNpc].map(([key, bucket]) => ({
      key: `npc:${key}`,
      label: npcLabel(key),
      dialogues: bucket.dialogues,
      counts: bucket.counts,
      target: { kind: 'npcs', npcKeys: [key] } as const,
    })),
  )
  if (rows.length <= NPC_LIMIT + 1) return rows

  const head = rows.slice(0, NPC_LIMIT)
  const tail = rows.slice(NPC_LIMIT)
  const merged = emptyTally()
  for (const row of tail) {
    merged.dialogues += row.dialogues
    for (const segment of SEGMENT_KEYS) merged.counts[segment] += row.counts[segment]
  }
  head.push({
    key: 'npc-other',
    label: `Other (${tail.length} NPCs)`,
    dialogues: merged.dialogues,
    counts: merged.counts,
    // The whole tail as one OR-set: clicking "Other" shows exactly the bar's contents.
    target: { kind: 'npcs', npcKeys: tail.flatMap((row) => npcKeysOf(row.target)) },
  })
  return head
}

function npcKeysOf(target: RowTarget): readonly string[] {
  return target.kind === 'npcs' ? target.npcKeys : []
}

/** Descending by line count, then by label, so equal bars keep a stable order across renders. */
function sortByDialogues(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.sort((a, b) => b.dialogues - a.dialogues || a.label.localeCompare(b.label))
}

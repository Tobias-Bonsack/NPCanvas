import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { RELEVANCE_STYLE, relevanceColor } from '../dialogue/relevance.ts'
import type { Dialogue, DialogueId, RelevanceTag, Zone, ZoneId } from '../project/types.ts'
import { RELEVANCE_TAGS } from '../project/types.ts'
import type { DialogueFilter, ZoneScope } from './filters.ts'
import { NO_ZONE, npcKey, npcLabel } from './filters.ts'

/**
 * A stacked segment is one relevance tag, or the absence of all of them. "Untagged" is a real
 * answer — the canvas legend names it too — so it gets a segment rather than shrinking the bar.
 */
type SegmentKey = RelevanceTag | 'untagged'

const SEGMENT_KEYS: readonly SegmentKey[] = [...RELEVANCE_TAGS, 'untagged']

const SEGMENT_LABEL: Record<SegmentKey, string> = {
  'out-of-world': RELEVANCE_STYLE['out-of-world'].label,
  worldbuilding: RELEVANCE_STYLE.worldbuilding.label,
  peoplebuilding: RELEVANCE_STYLE.peoplebuilding.label,
  other: RELEVANCE_STYLE.other.label,
  untagged: 'Untagged',
}

/**
 * Fixed colours rather than theme tokens: these are the hues the pins already fly, and a
 * segment has to mean the same thing on the canvas and in the chart. All five are mid-lightness,
 * so `--chart-ink` (a near-black) stays legible on every one of them in either colour scheme.
 */
const SEGMENT_COLOR: Record<SegmentKey, string> = {
  'out-of-world': relevanceColor('out-of-world'),
  worldbuilding: relevanceColor('worldbuilding'),
  peoplebuilding: relevanceColor('peoplebuilding'),
  other: relevanceColor('other'),
  untagged: 'hsl(220 8% 62%)',
}

/**
 * A texture per segment, so the chart survives being read by someone who cannot tell the hues
 * apart — and printed in greyscale. The shapes are deliberately different in *kind* (diagonal,
 * counter-diagonal, dots, grid, verticals), not just in density.
 */
function SegmentPattern({ id, segment }: { id: string; segment: SegmentKey }): ReactElement {
  const ink = 'rgba(0, 0, 0, 0.34)'
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      {segment === 'out-of-world' && <path d="M0 6 6 0" stroke={ink} strokeWidth="1.6" />}
      {segment === 'worldbuilding' && <path d="M0 0 6 6" stroke={ink} strokeWidth="1.6" />}
      {segment === 'peoplebuilding' && <circle cx="3" cy="3" r="1.3" fill={ink} />}
      {segment === 'other' && <path d="M0 3h6M3 0v6" stroke={ink} strokeWidth="1.1" />}
      {segment === 'untagged' && <path d="M1.5 0v6" stroke={ink} strokeWidth="1.2" />}
    </pattern>
  )
}

/** What clicking a row's segment narrows to — the row's own axis, whichever chart it is in. */
type RowTarget =
  | { kind: 'zones'; zones: readonly ZoneScope[] }
  | { kind: 'npcs'; npcKeys: readonly string[] }

type BreakdownRow = {
  key: string
  label: string
  /** Distinct dialogues, which is what the row is sorted and labelled by. */
  dialogues: number
  /** Tag occurrences: a line with two tags lands in both segments, so these sum higher. */
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
        <BreakdownChart
          idPrefix="zone"
          title="By zone"
          rows={byZone}
          emptyMessage="No dialogues to break down."
          onSelect={select}
        />
        <BreakdownChart
          idPrefix="npc"
          title="By NPC"
          rows={byNpc}
          emptyMessage="No dialogues to break down."
          onSelect={select}
        />
      </div>
    </section>
  )
}

function SegmentLegend(): ReactElement {
  return (
    <ul className="insights__legend">
      {SEGMENT_KEYS.map((segment) => (
        <li key={segment} className="insights__legend-item">
          <svg className="insights__legend-swatch" viewBox="0 0 12 12" aria-hidden="true">
            <defs>
              <SegmentPattern id={`legend-${segment}`} segment={segment} />
            </defs>
            <rect width="12" height="12" fill={SEGMENT_COLOR[segment]} />
            <rect width="12" height="12" fill={`url(#legend-${segment})`} />
          </svg>
          {SEGMENT_LABEL[segment]}
        </li>
      ))}
    </ul>
  )
}

// One coordinate system for both charts, in viewBox units. The svg is width:100% / height:auto,
// so these are proportions the browser scales — never device pixels.
const WIDTH = 720
const LABEL_WIDTH = 168
const TOTAL_WIDTH = 44
const GAP = 10
const BAR_X = LABEL_WIDTH + GAP
const BAR_WIDTH = WIDTH - BAR_X - TOTAL_WIDTH - GAP
const ROW_HEIGHT = 22
const ROW_PITCH = 30
/** Below this a count label does not fit inside its segment and is left to the tooltip. */
const LABEL_MIN_SEGMENT = 24

function BreakdownChart({
  idPrefix,
  title,
  rows,
  emptyMessage,
  onSelect,
}: {
  idPrefix: string
  title: string
  rows: readonly BreakdownRow[]
  emptyMessage: string
  onSelect: (target: RowTarget, segment: SegmentKey) => void
}): ReactElement {
  const height = Math.max(rows.length * ROW_PITCH, ROW_PITCH)
  // A single row must still fill the bar rather than being drawn as a sliver of an imagined
  // larger maximum, so the scale is the largest row, never a fixed ceiling.
  const widest = rows.reduce((max, row) => Math.max(max, total(row.counts)), 0)

  return (
    <figure className="insights__chart">
      <figcaption className="insights__chart-title">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="insights__empty">{emptyMessage}</p>
      ) : (
        <svg
          className="insights__svg"
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="img"
          aria-label={title}
        >
          <defs>
            {SEGMENT_KEYS.map((segment) => (
              <SegmentPattern key={segment} id={`${idPrefix}-${segment}`} segment={segment} />
            ))}
          </defs>
          {rows.map((row, index) => (
            <BreakdownBar
              key={row.key}
              idPrefix={idPrefix}
              row={row}
              y={index * ROW_PITCH}
              scale={widest === 0 ? 0 : BAR_WIDTH / widest}
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
  scale,
  onSelect,
}: {
  idPrefix: string
  row: BreakdownRow
  y: number
  scale: number
  onSelect: (target: RowTarget, segment: SegmentKey) => void
}): ReactElement {
  const middle = y + ROW_HEIGHT / 2
  let x = BAR_X

  return (
    <g>
      <title>{`${row.label}: ${row.dialogues}`}</title>
      <text className="insights__row-label" x={LABEL_WIDTH} y={middle} textAnchor="end">
        {truncate(row.label, 26)}
      </text>
      <rect
        className="insights__track"
        x={BAR_X}
        y={y}
        width={BAR_WIDTH}
        height={ROW_HEIGHT}
        rx="3"
      />
      {SEGMENT_KEYS.map((segment) => {
        const count = row.counts[segment]
        if (count === 0) return null
        const width = count * scale
        const left = x
        x += width
        const label = `${row.label}, ${SEGMENT_LABEL[segment]}: ${count}`
        return (
          <g
            key={segment}
            className="insights__segment"
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={() => onSelect(row.target, segment)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect(row.target, segment)
            }}
          >
            <title>{label}</title>
            <rect x={left} y={y} width={width} height={ROW_HEIGHT} fill={SEGMENT_COLOR[segment]} />
            <rect
              x={left}
              y={y}
              width={width}
              height={ROW_HEIGHT}
              fill={`url(#${idPrefix}-${segment})`}
            />
            {width >= LABEL_MIN_SEGMENT && (
              <text
                className="insights__segment-count"
                x={left + width / 2}
                y={middle}
                textAnchor="middle"
              >
                {count}
              </text>
            )}
          </g>
        )
      })}
      <text className="insights__row-total" x={WIDTH} y={middle} textAnchor="end">
        {row.dialogues}
      </text>
    </g>
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

type Tally = { dialogues: number; counts: Record<SegmentKey, number> }

function emptyTally(): Tally {
  return {
    dialogues: 0,
    counts: { 'out-of-world': 0, worldbuilding: 0, peoplebuilding: 0, other: 0, untagged: 0 },
  }
}

function tally(bucket: Tally, dialogue: Dialogue): void {
  bucket.dialogues += 1
  if (dialogue.relevance.length === 0) {
    bucket.counts.untagged += 1
    return
  }
  for (const tag of dialogue.relevance) bucket.counts[tag] += 1
}

function total(counts: Record<SegmentKey, number>): number {
  return SEGMENT_KEYS.reduce((sum, segment) => sum + counts[segment], 0)
}

/** Descending by line count, then by label, so equal bars keep a stable order across renders. */
function sortByDialogues(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.sort((a, b) => b.dialogues - a.dialogues || a.label.localeCompare(b.label))
}

/** SVG text has no ellipsis, so the row label is cut in JS or it overruns into the bars. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

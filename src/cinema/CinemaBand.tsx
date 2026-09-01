import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { useMemo } from 'react'
import { useChartWidth } from '../insights/chart-width.ts'
import { zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import { byId } from '../project/derived.ts'
import type { ProjectFile } from '../project/types.ts'
import type { BandSlot } from './band-layout.ts'
import { MAX_SLOT_HEIGHT, bandLayout } from './band-layout.ts'
import type { Moment, Reel } from './reel.ts'

// viewBox units, and (per chart-width.ts) one viewBox unit is one real CSS pixel.
const DEFAULT_WIDTH = 720
const ARC_LIFT = 24
// Must be >= ARC_LIFT, or the tallest slot's arc peaks above y=0 and the SVG's default
// `overflow: hidden` clips it.
const PLOT_TOP = ARC_LIFT
const SLOT_BASELINE = PLOT_TOP + MAX_SLOT_HEIGHT
const HEIGHT = SLOT_BASELINE + 4

/** The whole reel at one slot per line — see CLAUDE.md § "Cinema" and #159. */
export function CinemaBand({
  project,
  reel,
  moment,
  onSeekMoment,
}: {
  project: ProjectFile
  reel: Reel
  moment: Moment
  onSeekMoment: (index: number) => void
}): ReactElement {
  const [svgRef, width] = useChartWidth<SVGSVGElement>(DEFAULT_WIDTH)
  // Only the walked moments — see band-layout.ts for why this is what makes the band fill from
  // the right instead of sitting at a fixed spot in a timeline sized for the whole reel.
  const walked = useMemo(() => reel.moments.slice(0, moment.index + 1), [reel, moment.index])
  const slots = useMemo(() => bandLayout(walked, width), [walked, width])
  const zonesById = byId(project.zones)

  const momentIndexById = useMemo(
    () => new Map(reel.moments.map((candidate) => [candidate.dialogue.id, candidate.index])),
    [reel],
  )

  function seekAt(event: ReactPointerEvent<SVGSVGElement>): void {
    if (walked.length === 0) return
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientX - box.left) / box.width
    const index = Math.min(Math.max(Math.floor(fraction * walked.length), 0), walked.length - 1)
    onSeekMoment(index)
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    seekAt(event)
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event)
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const zoneName = moment.zoneId === null ? null : (zonesById.get(moment.zoneId) ?? null)
  const valueText = `${moment.dialogue.npcName}${zoneName !== null ? `, ${zoneLabel(zoneName)}` : ''}`

  // slots[i].moment.index === i, since `walked` is the reel's own prefix. Every reference between
  // two already-walked lines gets its arc, not just ones touching the current moment — a link
  // stays visible on the band once both ends have played, regardless of where the playhead sits.
  const arcs = useMemo(
    () =>
      walked.flatMap((candidate) => {
        const fromSlot = slots[candidate.index]
        if (fromSlot === undefined) return []
        return candidate.dialogue.references.flatMap((targetId) => {
          const targetIndex = momentIndexById.get(targetId)
          if (targetIndex === undefined || targetIndex > candidate.index) return []
          const toSlot = slots[targetIndex]
          return toSlot === undefined ? [] : [{ from: fromSlot, to: toSlot }]
        })
      }),
    [walked, slots, momentIndexById],
  )

  return (
    <svg
      ref={svgRef}
      className="cinema-band"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="slider"
      tabIndex={0}
      aria-label="Position in the journey"
      aria-valuemin={0}
      aria-valuemax={moment.index}
      aria-valuenow={moment.index}
      aria-valuetext={valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {slots.map((slot) => (
        <rect
          key={slot.moment.dialogue.id}
          className="cinema-band__slot"
          data-current={slot.moment.index === moment.index ? '' : undefined}
          data-zone={slot.moment.zoneId === null ? 'none' : undefined}
          style={
            slot.moment.zoneId === null
              ? undefined
              : zoneHueStyle(zonesById.get(slot.moment.zoneId)?.hue ?? 0)
          }
          x={slot.x}
          y={SLOT_BASELINE - slot.height}
          width={Math.max(slot.width - 0.5, 0.5)}
          height={slot.height}
        />
      ))}

      {arcs.map(({ from, to }) => (
        <path
          key={`${from.moment.dialogue.id}-${to.moment.dialogue.id}`}
          className="cinema-band__arc"
          d={arcPath(from, to)}
        />
      ))}
    </svg>
  )
}

function arcPath(from: BandSlot, to: BandSlot): string {
  const x1 = from.x + from.width / 2
  const x2 = to.x + to.width / 2
  const y1 = SLOT_BASELINE - from.height
  const y2 = SLOT_BASELINE - to.height
  const midX = (x1 + x2) / 2
  const peakY = Math.min(y1, y2) - ARC_LIFT
  return `M ${x1} ${y1} Q ${midX} ${peakY} ${x2} ${y2}`
}

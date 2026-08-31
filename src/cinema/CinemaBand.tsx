import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { useMemo } from 'react'
import { useChartWidth } from '../insights/chart-width.ts'
import { zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import { byId } from '../project/derived.ts'
import type { ProjectFile } from '../project/types.ts'
import type { BandNotch, BandSlot } from './band-layout.ts'
import { MAX_SLOT_HEIGHT, bandLayout } from './band-layout.ts'
import type { Moment, Reel } from './reel.ts'

// viewBox units, and (per chart-width.ts) one viewBox unit is one real CSS pixel.
const DEFAULT_WIDTH = 720
const PLOT_TOP = 4
const SLOT_BASELINE = PLOT_TOP + MAX_SLOT_HEIGHT
const NOTCH_LABEL_Y = SLOT_BASELINE + 14
const HEIGHT = NOTCH_LABEL_Y + 4
const ARC_LIFT = 20

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
  const layout = useMemo(() => bandLayout(reel, width), [reel, width])
  const zonesById = byId(project.zones)

  const momentIndexById = useMemo(
    () => new Map(reel.moments.map((candidate) => [candidate.dialogue.id, candidate.index])),
    [reel],
  )

  function seekAt(event: ReactPointerEvent<SVGSVGElement>): void {
    if (reel.moments.length === 0) return
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientX - box.left) / box.width
    const index = Math.min(Math.max(Math.floor(fraction * reel.moments.length), 0), reel.moments.length - 1)
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

  // Nothing not yet played shows on the band — neither its slot nor a line to or from it.
  const walkedSlots = layout.slots.filter((slot) => slot.moment.index <= moment.index)

  const currentSlot: BandSlot | undefined = layout.slots[moment.index]
  const outgoing = currentSlot === undefined
    ? []
    : moment.dialogue.references.flatMap((targetId) => {
        const targetIndex = momentIndexById.get(targetId)
        if (targetIndex === undefined || targetIndex > moment.index) return []
        const targetSlot = layout.slots[targetIndex]
        return targetSlot === undefined ? [] : [{ from: currentSlot, to: targetSlot }]
      })
  // The reverse of `dialogue.references` — a walked line that points at the current one gets its
  // arc too, not just the current line's own outgoing references.
  const incoming = currentSlot === undefined
    ? []
    : reel.moments.slice(0, moment.index).flatMap((candidate) => {
        if (!candidate.dialogue.references.includes(moment.dialogue.id)) return []
        const sourceSlot = layout.slots[candidate.index]
        return sourceSlot === undefined ? [] : [{ from: sourceSlot, to: currentSlot }]
      })
  const arcs = [...outgoing, ...incoming]

  return (
    <svg
      ref={svgRef}
      className="cinema-band"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="slider"
      tabIndex={0}
      aria-label="Position in the journey"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, reel.moments.length - 1)}
      aria-valuenow={moment.index}
      aria-valuetext={valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {walkedSlots.map((slot) => (
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

      {layout.notches.map((notch, index) => (
        <NotchMark key={index} notch={notch} />
      ))}
    </svg>
  )
}

function NotchMark({ notch }: { notch: BandNotch }): ReactElement {
  return (
    <g className="cinema-band__notch">
      <line x1={notch.x} y1={PLOT_TOP} x2={notch.x} y2={SLOT_BASELINE} />
      <text x={notch.x} y={NOTCH_LABEL_Y} textAnchor="middle">
        {notch.label}
      </text>
    </g>
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

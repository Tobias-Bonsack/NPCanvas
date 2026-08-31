import type { ZoneId } from '../project/types.ts'
import type { Moment, Reel } from './reel.ts'

/** One line's own column on the band — see CLAUDE.md § "Cinema". */
export type BandSlot = {
  moment: Moment
  x: number
  width: number
  height: number
}

/** A boundary where a real-time gap crossed a session break; carries the gap it hides. */
export type BandNotch = {
  x: number
  gapMs: number
  label: string
}

/** A run of consecutive moments sharing one zone (or none) — breaks only where the zone changes. */
export type ZoneRun = {
  zoneId: ZoneId | null
  x: number
  width: number
}

export type BandLayout = {
  slots: BandSlot[]
  notches: BandNotch[]
  zoneRuns: ZoneRun[]
}

export const MIN_SLOT_HEIGHT = 4
export const MAX_SLOT_HEIGHT = 36

// The Brock fight's 50 frames is the reference point named in #159 — a line with this many
// frames sits at the top of the log scale, and anything past it still clamps there rather than
// blowing the row.
const HEIGHT_REFERENCE_FRAMES = 50

function slotHeight(frameCount: number): number {
  const ratio = Math.log1p(Math.max(0, frameCount)) / Math.log1p(HEIGHT_REFERENCE_FRAMES)
  const raw = MIN_SLOT_HEIGHT + (MAX_SLOT_HEIGHT - MIN_SLOT_HEIGHT) * ratio
  return Math.min(MAX_SLOT_HEIGHT, Math.max(MIN_SLOT_HEIGHT, raw))
}

// index === count returns `width` exactly, never a float that merely rounds to it — the last
// slot's right edge must equal `width` bit for bit, not just approximately.
function boundary(index: number, count: number, width: number): number {
  return index >= count ? width : (index * width) / count
}

function formatGap(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

/** Pure over `reel` and a target width — see CLAUDE.md § "Testing scope". */
export function bandLayout(reel: Reel, width: number): BandLayout {
  const count = reel.moments.length
  if (count === 0) return { slots: [], notches: [], zoneRuns: [] }

  const slots: BandSlot[] = reel.moments.map((moment: Moment) => {
    const x = boundary(moment.index, count, width)
    return {
      moment,
      x,
      width: boundary(moment.index + 1, count, width) - x,
      height: slotHeight(moment.dialogue.media.length),
    }
  })

  const zoneRuns: ZoneRun[] = []
  const runStart: number[] = []
  for (const moment of reel.moments) {
    const lastIndex = zoneRuns.length - 1
    if (lastIndex >= 0 && zoneRuns[lastIndex].zoneId === moment.zoneId) continue
    if (lastIndex >= 0) {
      const start = runStart[lastIndex]
      zoneRuns[lastIndex].x = boundary(start, count, width)
      zoneRuns[lastIndex].width = boundary(moment.index, count, width) - zoneRuns[lastIndex].x
    }
    zoneRuns.push({ zoneId: moment.zoneId, x: 0, width: 0 })
    runStart.push(moment.index)
  }
  const last = zoneRuns.length - 1
  if (last >= 0) {
    zoneRuns[last].x = boundary(runStart[last], count, width)
    zoneRuns[last].width = width - zoneRuns[last].x
  }

  // sessions[0] never opened on a gap — every later session did, by construction (reel.ts).
  const notches: BandNotch[] = reel.sessions.slice(1).map((session) => ({
    x: boundary(session.firstMoment.index, count, width),
    gapMs: session.gapMsBefore,
    label: formatGap(session.gapMsBefore),
  }))

  return { slots, notches, zoneRuns }
}

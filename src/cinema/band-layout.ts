import type { Moment } from './reel.ts'

/** One line's own column on the band — see CLAUDE.md § "Cinema". */
export type BandSlot = {
  moment: Moment
  x: number
  width: number
  height: number
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

// `walked` is only the moments played so far, in order, ending with the current one — never the
// whole reel. Slotting against `walked.length` (not the reel's total) is what makes the band
// fill from the right as the playhead advances: the newest moment's slot always ends at `width`,
// and every earlier slot narrows to make room for it, rather than sitting at a fixed position
// sized for a timeline that never grows past "so far".
/** Pure over the walked moments and a target width — see CLAUDE.md § "Testing scope". */
export function bandLayout(walked: Moment[], width: number): BandSlot[] {
  const count = walked.length
  if (count === 0) return []

  return walked.map((moment: Moment, position: number) => {
    const x = boundary(position, count, width)
    return {
      moment,
      x,
      width: boundary(position + 1, count, width) - x,
      height: slotHeight(moment.dialogue.media.length),
    }
  })
}

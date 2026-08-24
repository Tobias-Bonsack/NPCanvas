import type { ReactElement } from 'react'
import { TILE_SIZE } from './capture-profile.ts'
import { isGlyphPixelSet, parseGlyphBits } from './glyph-matcher.ts'

/**
 * One 8 × 8 tile, drawn large enough to read.
 *
 * An `<svg>` of one rect per ink pixel rather than an upscaled bitmap: this is where the user
 * judges what a tile *is* — naming it in the learner, and recognising a mis-named one in the
 * set — and a scaled image would leave that to the browser's smoothing.
 *
 * Shared by both so the two cannot draw the same bitmap differently: a glyph that looked like one
 * thing while it was being learned and another while it is being reviewed would make the review
 * useless. No stylesheet of its own; the class comes from whichever view is rendering it.
 */
export function GlyphTile({
  bits,
  className,
  label,
}: {
  bits: string
  className: string
  label: string
}): ReactElement {
  const rows = parseGlyphBits(bits)
  const pixels: ReactElement[] = []
  if (rows !== null) {
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let column = 0; column < TILE_SIZE; column++) {
        if (!isGlyphPixelSet(rows, column, row)) continue
        pixels.push(<rect key={`${column},${row}`} x={column} y={row} width={1} height={1} />)
      }
    }
  }
  return (
    <svg className={className} viewBox={`0 0 ${TILE_SIZE} ${TILE_SIZE}`} role="img" aria-label={label}>
      {pixels}
    </svg>
  )
}

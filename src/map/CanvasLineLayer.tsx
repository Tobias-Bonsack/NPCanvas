import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { Rect } from './geometry.ts'
import type { TrailArrow } from './trail-path.ts'

/**
 * The shell shared by every canvas-space line layer (`TrailLayer`, `ReferenceLayer`): the
 * `mapsBounds` `<svg>`, the halo-then-path double stroke, and the direction arrowheads. Each
 * caller keeps its own geometry and filter semantics, and hands over only the drawn shapes.
 */
export function CanvasLineLayer({
  classPrefix,
  bounds,
  halo,
  path,
  arrows,
}: {
  classPrefix: string
  bounds: Rect
  halo: ReactNode
  path: ReactNode
  arrows: readonly TrailArrow[]
}): ReactElement {
  return (
    <div className={classPrefix}>
      <svg
        className={`${classPrefix}__svg`}
        style={{ left: `${bounds.x}px`, top: `${bounds.y}px` }}
        width={bounds.width}
        height={bounds.height}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        aria-hidden="true"
      >
        {/* Two passes: a wider dark halo stroke underneath, the coloured line on top — a stroke
            has no fill, so this is what an outlined stroke is. No vector-effect: see MapCanvas.css
            for the measured non-scaling-stroke finding this app can't rely on. */}
        {halo}
        {path}
        {arrows.map((arrow, index) => (
          <Arrowhead key={index} classPrefix={classPrefix} arrow={arrow} />
        ))}
      </svg>
    </div>
  )
}

// translate/rotate come from the geometry; the counter-scale keeping the head a constant screen
// size is in CSS against --map-zoom, since vector-effect leaves a stroke unscaled but not a shape.
function Arrowhead({ classPrefix, arrow }: { classPrefix: string; arrow: TrailArrow }): ReactElement {
  return <path className={`${classPrefix}__arrow`} style={arrowStyle(arrow)} d={ARROW_HEAD} />
}

// A triangle about the origin pointing along +x, in canvas units before the counter-scale.
const ARROW_HEAD = 'M -6 -6 L 9 0 L -6 6 Z'

function arrowStyle(arrow: TrailArrow): CSSProperties & Record<'--arrow-place', string> {
  return {
    '--arrow-place': `translate(${arrow.point.x}px, ${arrow.point.y}px) rotate(${arrow.angle}deg)`,
  }
}

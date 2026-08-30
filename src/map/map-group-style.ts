import type { CSSProperties } from 'react'
import type { GameMap } from '../project/types.ts'

// Own module because both MapCanvas (images) and PinLayer (pins) emit a group for the same map,
// and the two transforms must never drift apart. --map-scale inherits so anything inside can
// counter-scale against canvas-zoom x map-scale with one property write, not one per pin.
export function mapGroupStyle(map: GameMap): CSSProperties & Record<'--map-scale', string> {
  return {
    transform: `translate(${map.origin.x}px, ${map.origin.y}px) scale(${map.scale})`,
    '--map-scale': String(map.scale),
  }
}

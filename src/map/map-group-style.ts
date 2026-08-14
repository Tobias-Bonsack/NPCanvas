import type { CSSProperties } from 'react'
import type { GameMap } from '../project/types.ts'

/**
 * One map's placement on the shared canvas, as the CSS transform its contents sit under.
 *
 * `--map-scale` is published alongside it so anything inside the group can counter-scale
 * against the *product* of canvas zoom and map scale. Custom properties inherit, so that
 * stays one property write per map rather than one per pin.
 *
 * Its own module because both `MapCanvas` (the images) and `PinLayer` (the pins) emit a
 * group for the same map, and the two transforms must never drift apart. Not in
 * `canvas-layout.ts`, which is deliberately free of anything React-shaped.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 */
export function mapGroupStyle(map: GameMap): CSSProperties & Record<'--map-scale', string> {
  return {
    transform: `translate(${map.origin.x}px, ${map.origin.y}px) scale(${map.scale})`,
    '--map-scale': String(map.scale),
  }
}

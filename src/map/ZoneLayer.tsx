import type { ReactElement } from 'react'
import { memo, useMemo } from 'react'
import type { GameMap, MapId, Point, Polygon, Zone, ZoneId } from '../project/types.ts'
import { polygonCentroid } from './geometry.ts'
import { mapGroupStyle } from './map-group-style.ts'
import { zoneHueStyle } from './zone-style.ts'

/**
 * The named regions, drawn beneath the pins.
 *
 * One inline `<svg>` per map, sized and `viewBox`ed to the map image, so a zone's polygon is
 * written into the `points` attribute verbatim: the group's transform already carries the
 * map's placement, and the viewBox makes one user unit one map-local pixel. There is no
 * coordinate maths in this file at all, which is the point.
 *
 * Purely presentational and `pointer-events: none`. Clicks are hit-tested geometrically in
 * `MapCanvas` — a filled polygon that took the pointer would swallow every pan that began
 * inside a zone, and the canvas's pointer capture means it would never see the pointerup
 * anyway.
 *
 * `memo` for the reason recorded in CLAUDE.md: no prop here is derived from the viewport, so
 * panning and zooming re-render `MapCanvas` without touching this subtree.
 */
export const ZoneLayer = memo(function ZoneLayer({
  maps,
  zones,
  selectedId,
}: {
  /** Already carrying any in-progress map drag preview — see `MapScreen`. */
  maps: readonly GameMap[]
  /** Likewise carrying any in-progress zone drag preview. */
  zones: readonly Zone[]
  selectedId: ZoneId | null
}): ReactElement {
  // Rebuilding this per render would hand every group a fresh array and undo the memo above.
  const byMap = useMemo(() => groupByMap(maps, zones), [maps, zones])

  return (
    <div className="zone-layer">
      {maps.map((map) => (
        <div key={map.id} className="zone-layer__map" style={mapGroupStyle(map)}>
          <svg
            className="zone-layer__svg"
            width={map.width}
            height={map.height}
            viewBox={`0 0 ${map.width} ${map.height}`}
          >
            {(byMap.get(map.id) ?? []).map((zone) => (
              <ZoneShape key={zone.id} zone={zone} selected={zone.id === selectedId} />
            ))}
          </svg>
        </div>
      ))}
    </div>
  )
})

function ZoneShape({ zone, selected }: { zone: Zone; selected: boolean }): ReactElement {
  const label = polygonCentroid(zone.polygon)
  return (
    <g style={zoneHueStyle(zone.hue)}>
      {/* `vector-effect` is what keeps the outline a constant width at any zoom without a
          single line of JS — the stroke is simply not scaled by the ancestor transforms. */}
      <polygon
        className="zone-layer__shape"
        data-selected={selected ? 'true' : undefined}
        points={pointsAttribute(zone.polygon)}
        vectorEffect="non-scaling-stroke"
      />
      {/* Counter-scaled in CSS against the same product the pins use, so the name stays the
          same size on screen however far the canvas is zoomed out. `transform-box: fill-box`
          there is load-bearing: the default view-box origin would scale the label away from
          its centroid instead of about it. */}
      <text
        className="zone-layer__label"
        x={label.x}
        y={label.y}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {zone.name}
      </text>
    </g>
  )
}

/** SVG's own vertex list format: "x,y x,y …". */
function pointsAttribute(polygon: Polygon): string {
  return polygon.map((point: Point) => `${point.x},${point.y}`).join(' ')
}

/**
 * Zones bucketed by map, in one pass. A zone naming a map that is not in `maps` belongs to no
 * group and is simply not rendered — the cascade in `map/deleted` means that can only be a
 * transient mid-dispatch state, never a document a user sees.
 */
function groupByMap(
  maps: readonly GameMap[],
  zones: readonly Zone[],
): ReadonlyMap<MapId, Zone[]> {
  const byMap = new Map<MapId, Zone[]>()
  for (const map of maps) byMap.set(map.id, [])
  for (const zone of zones) byMap.get(zone.mapId)?.push(zone)
  return byMap
}

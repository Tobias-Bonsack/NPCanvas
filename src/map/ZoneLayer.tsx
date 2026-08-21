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
  // Keyed on the zones alone, for the reason `PinLayer` gives: `maps` is a fresh array on
  // every frame of a map drag, and which map a zone is drawn on is written on the zone.
  const byMap = useMemo(() => groupByMap(zones), [zones])

  return (
    <div className="zone-layer">
      {maps.map((map) => (
        <ZoneMapGroup
          key={map.id}
          map={map}
          zones={byMap.get(map.id) ?? NO_ZONES}
          selectedId={selectedId}
        />
      ))}
    </div>
  )
})

/** One shared empty array, so a map with no zones is handed the same reference every render. */
const NO_ZONES: readonly Zone[] = []

/**
 * One map's zones. Memoized on the map object, so a map drag re-renders the dragged map's
 * group alone — the mirror of `PinMapGroup`, and for the same reason.
 */
const ZoneMapGroup = memo(function ZoneMapGroup({
  map,
  zones,
  selectedId,
}: {
  map: GameMap
  zones: readonly Zone[]
  selectedId: ZoneId | null
}): ReactElement {
  return (
    <div className="zone-layer__map" style={mapGroupStyle(map)}>
      <svg
        className="zone-layer__svg"
        width={map.width}
        height={map.height}
        viewBox={`0 0 ${map.width} ${map.height}`}
      >
        {zones.map((zone) => (
          <ZoneShape key={zone.id} zone={zone} selected={zone.id === selectedId} />
        ))}
      </svg>
    </div>
  )
})

/**
 * `memo` plus a memoized centroid, so dragging one zone re-renders and re-measures that zone
 * alone. The layer above re-renders whenever any zone moves — every other shape's polygon is
 * the same object it was, and a centroid is a walk of every vertex.
 */
const ZoneShape = memo(function ZoneShape({
  zone,
  selected,
}: {
  zone: Zone
  selected: boolean
}): ReactElement {
  const label = useMemo(() => polygonCentroid(zone.polygon), [zone.polygon])
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
})

/** SVG's own vertex list format: "x,y x,y …". */
function pointsAttribute(polygon: Polygon): string {
  return polygon.map((point: Point) => `${point.x},${point.y}`).join(' ')
}

/**
 * Zones bucketed by map, in one pass. A zone naming a map the project does not have lands in
 * a bucket nothing renders — the cascade in `map/deleted` means that can only be a transient
 * mid-dispatch state, never a document a user sees.
 */
function groupByMap(zones: readonly Zone[]): ReadonlyMap<MapId, Zone[]> {
  const byMap = new Map<MapId, Zone[]>()
  for (const zone of zones) {
    const bucket = byMap.get(zone.mapId)
    if (bucket === undefined) byMap.set(zone.mapId, [zone])
    else bucket.push(zone)
  }
  return byMap
}

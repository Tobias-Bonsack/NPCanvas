import type { ReactElement } from 'react'
import { memo, useMemo } from 'react'
import type { GameMap, MapId, Point, Polygon, Zone, ZoneId } from '../project/types.ts'
import { canvasRectToMapLocal } from './canvas-layout.ts'
import type { Rect } from './geometry.ts'
import { polygonBounds, polygonCentroid, rectsOverlap } from './geometry.ts'
import { mapGroupStyle } from './map-group-style.ts'
import { zoneHueStyle } from './zone-style.ts'

// ZoneLayer takes no pointer events (CSS `pointer-events: none`) — clicks are hit-tested
// geometrically in MapCanvas instead, since a filled polygon would swallow every pan starting
// inside a zone and the canvas's own pointer capture would never see the pointerup anyway.
// memo'd like PinLayer: no prop here is viewport-derived, so panning never touches this subtree.
export const ZoneLayer = memo(function ZoneLayer({
  maps,
  zones,
  selectedId,
  visibleRect,
}: {
  maps: readonly GameMap[]
  zones: readonly Zone[]
  selectedId: ZoneId | null
  visibleRect: Rect | null
}): ReactElement {
  const byMap = useMemo(() => groupByMap(zones), [zones])

  return (
    <div className="zone-layer">
      {maps.map((map) => (
        <ZoneMapGroup
          key={map.id}
          map={map}
          zones={byMap.get(map.id) ?? NO_ZONES}
          selectedId={selectedId}
          visibleRect={visibleRect}
        />
      ))}
    </div>
  )
})

const NO_ZONES: readonly Zone[] = []

// Memoized on the map object, mirroring PinMapGroup — a map drag re-renders only that group.
const ZoneMapGroup = memo(function ZoneMapGroup({
  map,
  zones,
  selectedId,
  visibleRect,
}: {
  map: GameMap
  zones: readonly Zone[]
  selectedId: ZoneId | null
  visibleRect: Rect | null
}): ReactElement {
  const shown = useMemo(() => {
    if (visibleRect === null) return zones
    const visible = canvasRectToMapLocal(map, visibleRect)
    return zones.filter(
      (zone) => rectsOverlap(visible, polygonBounds(zone.polygon)) || zone.id === selectedId,
    )
  }, [map, zones, selectedId, visibleRect])

  return (
    <div className="zone-layer__map" style={mapGroupStyle(map)}>
      <svg
        className="zone-layer__svg"
        width={map.width}
        height={map.height}
        viewBox={`0 0 ${map.width} ${map.height}`}
      >
        {shown.map((zone) => (
          <ZoneShape key={zone.id} zone={zone} selected={zone.id === selectedId} />
        ))}
      </svg>
    </div>
  )
})

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
      <polygon
        className="zone-layer__shape"
        data-selected={selected ? 'true' : undefined}
        points={pointsAttribute(zone.polygon)}
        vectorEffect="non-scaling-stroke"
      />
      {/* Counter-scaled in CSS; transform-box: fill-box there keeps the label scaling about its
          own centroid rather than the view-box origin. */}
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

function pointsAttribute(polygon: Polygon): string {
  return polygon.map((point: Point) => `${point.x},${point.y}`).join(' ')
}

function groupByMap(zones: readonly Zone[]): ReadonlyMap<MapId, Zone[]> {
  const byMap = new Map<MapId, Zone[]>()
  for (const zone of zones) {
    const bucket = byMap.get(zone.mapId)
    if (bucket === undefined) byMap.set(zone.mapId, [zone])
    else bucket.push(zone)
  }
  return byMap
}

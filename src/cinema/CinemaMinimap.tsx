import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { mapCanvasRect, mapLocalToCanvas, mapsBounds } from '../map/canvas-layout.ts'
import type { TrailVertex } from '../map/trail-path.ts'
import { trailVertices } from '../map/trail-path.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import type { GameMap, Point, ProjectFile, Zone } from '../project/types.ts'

// A schematic, never the map image — see CLAUDE.md § "Cinema" and #161. The viewBox comes from
// mapsBounds once and does not move with the playhead: the finished journey has to read as pale,
// unwalked ground from the first frame, which a camera following the playhead would hide.
// aria-hidden — the stage already names the current zone as text; see CinemaStage.
export function CinemaMinimap({
  project,
  momentIndex,
}: {
  project: ProjectFile
  momentIndex: number
}): ReactElement | null {
  const bounds = useMemo(() => mapsBounds(project.maps), [project.maps])
  // Same filter and order as buildReel's moments (both drop unparseable/orphaned lines the same
  // way), so momentIndex indexes this array directly — see trail-path.ts.
  const vertices = useMemo(
    () => trailVertices(project.maps, project.dialogues),
    [project.maps, project.dialogues],
  )

  if (bounds === null) return null

  // The viewBox spans thousands of units, so a literal stroke width would be invisible; derived
  // from the bounds' own extent instead, the same reasoning CLAUDE.md records for the trail.
  const unit = Math.max(bounds.width, bounds.height) / 1000
  const walked = vertices.slice(0, momentIndex + 1)
  const unwalked = vertices.slice(momentIndex)
  const current = vertices[momentIndex] ?? null

  return (
    <svg
      className="cinema-minimap"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      aria-hidden="true"
    >
      {project.maps.map((map) => (
        <MapOutline key={map.id} map={map} unit={unit} />
      ))}
      {project.zones.map((zone) => (
        <ZoneShape key={zone.id} zone={zone} maps={project.maps} unit={unit} />
      ))}
      {unwalked.length > 1 && (
        <polyline
          className="cinema-minimap__trail-ahead"
          points={vertexPoints(unwalked)}
          strokeWidth={unit * 3}
        />
      )}
      {walked.length > 1 && (
        <polyline
          className="cinema-minimap__trail-walked"
          points={vertexPoints(walked)}
          strokeWidth={unit * 3}
        />
      )}
      {current !== null && (
        <circle
          className="cinema-minimap__current"
          cx={current.point.x}
          cy={current.point.y}
          r={unit * 8}
        />
      )}
    </svg>
  )
}

function MapOutline({ map, unit }: { map: GameMap; unit: number }): ReactElement {
  const rect = mapCanvasRect(map)
  return (
    <rect
      className="cinema-minimap__map"
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      strokeWidth={unit * 2}
    />
  )
}

// No pointer events — the same reasoning as ZoneLayer: the inset isn't a navigation surface.
function ZoneShape({
  zone,
  maps,
  unit,
}: {
  zone: Zone
  maps: readonly GameMap[]
  unit: number
}): ReactElement | null {
  const map = maps.find((candidate) => candidate.id === zone.mapId)
  if (map === undefined) return null
  return (
    <polygon
      className="cinema-minimap__zone"
      style={zoneHueStyle(zone.hue)}
      points={polygonPoints(zone.polygon.map((point) => mapLocalToCanvas(map, point)))}
      strokeWidth={unit}
    />
  )
}

function vertexPoints(vertices: readonly TrailVertex[]): string {
  return polygonPoints(vertices.map((vertex) => vertex.point))
}

function polygonPoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

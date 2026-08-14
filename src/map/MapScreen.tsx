import type { ReactElement } from 'react'
import { useEffect } from 'react'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import type { GameMap, MapId, ProjectFile } from '../project/types.ts'
import { MapCanvas } from './MapCanvas.tsx'
import { MapImportButton, MapPicker } from './MapPicker.tsx'
import './MapScreen.css'

type MapRoute = Extract<Route, { kind: 'map' }>

export function MapScreen({
  project,
  route,
}: {
  project: ProjectFile
  route: MapRoute
}): ReactElement {
  const activeMap = resolveActiveMap(project.maps, route.mapId)

  // The URL is corrected to name the map actually being shown, so that a stale or bare
  // `#/map` link becomes shareable and a later dialogue deep link has a map to hang off.
  // `replace`, because the user never asked to go to the wrong map.
  useEffect(() => {
    if (activeMap === null || activeMap.id === route.mapId) return
    navigate(
      { kind: 'map', mapId: activeMap.id, dialogueId: route.dialogueId },
      { replace: true },
    )
  }, [activeMap, route.mapId, route.dialogueId])

  if (activeMap === null) {
    return (
      <section className="map-screen map-screen--empty">
        <div className="map-screen__cta">
          <h1 className="map-screen__title">Import a map</h1>
          <p className="map-screen__lead">
            NPCanvas pins dialogue onto a map image you supply — a screenshot of the in-game
            map is ideal. Its pixel dimensions become the coordinate system for every pin and
            zone, so import it once at the size you want to work at.
          </p>
          <MapImportButton label="Choose a map image" />
        </div>
      </section>
    )
  }

  return (
    <section className="map-screen">
      <header className="map-screen__bar">
        <MapPicker project={project} activeMap={activeMap} />
      </header>
      <div className="map-screen__canvas">
        {/* Keyed on the map so switching maps remounts the canvas: viewport, container
            measurement, and object URL all belong to one map and none should carry over. */}
        <MapCanvas key={activeMap.id} map={activeMap} />
      </div>
    </section>
  )
}

/** An unknown `mapId` falls back to the first map rather than rendering nothing. */
function resolveActiveMap(maps: GameMap[], mapId: MapId | null): GameMap | null {
  if (maps.length === 0) return null
  const requested = maps.find((map) => map.id === mapId)
  return requested === undefined ? maps[0] : requested
}

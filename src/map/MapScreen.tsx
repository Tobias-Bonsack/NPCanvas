import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import type { CanvasTool, GameMap, MapId, ProjectFile, Selection } from '../project/types.ts'
import { MapCanvas } from './MapCanvas.tsx'
import { MapImportButton, MapPicker } from './MapPicker.tsx'
import { PinLayer } from './PinLayer.tsx'
import './MapScreen.css'

type MapRoute = Extract<Route, { kind: 'map' }>

export function MapScreen({
  project,
  selection,
  route,
}: {
  project: ProjectFile
  selection: Selection
  route: MapRoute
}): ReactElement {
  const activeMap = resolveActiveMap(project.maps, route.mapId)
  // Which tool the canvas is in is transient UI, so it lives here and not in the store.
  const [tool, setTool] = useState<CanvasTool>({ kind: 'inspect' })

  // The URL is corrected to name the map actually being shown, so that a stale or bare
  // `#/map` link becomes shareable and a later dialogue deep link has a map to hang off.
  // `replace`, because the user never asked to go to the wrong map.
  useEffect(() => {
    if (activeMap === null || activeMap.id === route.mapId) return
    navigate({ kind: 'map', mapId: activeMap.id, dialogueId: route.dialogueId }, { replace: true })
  }, [activeMap, route.mapId, route.dialogueId])

  // Memoised because `PinLayer` is memoised: a fresh array on every render of this screen
  // would re-render every pin whenever the save indicator ticked.
  const activeMapId = activeMap?.id ?? null
  const pinnedDialogues = useMemo(
    () => project.dialogues.filter((dialogue) => dialogue.mapId === activeMapId),
    [project.dialogues, activeMapId],
  )

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
        <ToolPicker tool={tool} onChange={setTool} />
      </header>
      <div className="map-screen__canvas">
        {/* Keyed on the map so switching maps remounts the canvas: viewport, container
            measurement, and object URL all belong to one map and none should carry over. */}
        <MapCanvas key={activeMap.id} map={activeMap} tool={tool}>
          <PinLayer
            dialogues={pinnedDialogues}
            mapId={activeMap.id}
            selectedId={selection.kind === 'dialogue' ? selection.id : null}
          />
        </MapCanvas>
      </div>
    </section>
  )
}

/** Only the tools that do something today. `draw-zone` is offered once M5 implements it. */
const TOOLS: readonly { tool: CanvasTool; label: string; hint: string }[] = [
  { tool: { kind: 'inspect' }, label: 'Inspect', hint: 'Pan the map and select pins' },
  { tool: { kind: 'place-dialogue' }, label: 'Place dialogue', hint: 'Click the map to log a line' },
]

function ToolPicker({
  tool,
  onChange,
}: {
  tool: CanvasTool
  onChange: (tool: CanvasTool) => void
}): ReactElement {
  return (
    <div className="tool-picker" role="group" aria-label="Canvas tool">
      {TOOLS.map((entry) => (
        <button
          key={entry.tool.kind}
          type="button"
          className="tool-picker__button"
          aria-pressed={entry.tool.kind === tool.kind}
          title={entry.hint}
          onClick={() => onChange(entry.tool)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}

/** An unknown `mapId` falls back to the first map rather than rendering nothing. */
function resolveActiveMap(maps: GameMap[], mapId: MapId | null): GameMap | null {
  if (maps.length === 0) return null
  const requested = maps.find((map) => map.id === mapId)
  return requested === undefined ? maps[0] : requested
}

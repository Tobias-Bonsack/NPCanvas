import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import type { Route } from '../app/route.ts'
import type { CanvasTool, GameMap, ProjectFile, Selection } from '../project/types.ts'
import type { MapDragPreview } from './MapCanvas.tsx'
import { MapCanvas } from './MapCanvas.tsx'
import { MapImportButton, MapPicker } from './MapPicker.tsx'
import { PinLayer } from './PinLayer.tsx'
import './MapScreen.css'

type CanvasRoute = Extract<Route, { kind: 'canvas' }>

export function MapScreen({
  project,
  selection,
}: {
  project: ProjectFile
  selection: Selection
  route: CanvasRoute
}): ReactElement {
  // Which tool the canvas is in is transient UI, so it lives here and not in the store.
  const [tool, setTool] = useState<CanvasTool>({ kind: 'inspect' })
  // A map drag in progress. It lives here, above both world-space layers, because the image
  // and its pins have to move together in the same frame — and it stays out of the store,
  // which would push a document-shaped update through autosave on every pointermove.
  const [mapDrag, setMapDrag] = useState<MapDragPreview | null>(null)

  // Identical to `project.maps` whenever no drag is in flight, so `PinLayer`'s memo holds
  // and panning still costs no pin render.
  const placedMaps = useMemo(() => withDragPreview(project.maps, mapDrag), [project.maps, mapDrag])

  if (project.maps.length === 0) {
    return (
      <section className="map-screen map-screen--empty">
        <div className="map-screen__cta">
          <h1 className="map-screen__title">Import a map</h1>
          <p className="map-screen__lead">
            NPCanvas pins dialogue onto a map image you supply — a screenshot of the in-game
            map is ideal. Its pixel dimensions become the coordinate system for every pin and
            zone, so import it once at the size you want to work at.
          </p>
          <MapImportButton label="Choose a map image" maps={project.maps} />
        </div>
      </section>
    )
  }

  return (
    <section className="map-screen">
      <header className="map-screen__bar">
        <MapPicker project={project} />
        <ToolPicker tool={tool} onChange={setTool} />
      </header>
      <div className="map-screen__canvas">
        <MapCanvas
          maps={placedMaps}
          tool={tool}
          selectedMapId={selection.kind === 'map' ? selection.id : null}
          onMapDrag={setMapDrag}
        >
          <PinLayer
            maps={placedMaps}
            dialogues={project.dialogues}
            selectedId={selection.kind === 'dialogue' ? selection.id : null}
          />
        </MapCanvas>
      </div>
    </section>
  )
}

/**
 * The maps as they should be drawn right now: the document's, with the dragged one at its
 * live position. Returns the original array when nothing is being dragged — a fresh array
 * every render would defeat the memo on `PinLayer`.
 */
function withDragPreview(maps: GameMap[], drag: MapDragPreview | null): readonly GameMap[] {
  if (drag === null) return maps
  return maps.map((map) => (map.id === drag.id ? { ...map, origin: drag.origin } : map))
}

/** Only the tools that do something today. `draw-zone` is offered once M5 implements it. */
const TOOLS: readonly { tool: CanvasTool; label: string; hint: string }[] = [
  { tool: { kind: 'inspect' }, label: 'Inspect', hint: 'Pan the canvas and select pins' },
  {
    tool: { kind: 'place-dialogue' },
    label: 'Place dialogue',
    hint: 'Click a map to log a line',
  },
  { tool: { kind: 'move-map' }, label: 'Move map', hint: 'Drag a map to arrange the canvas' },
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

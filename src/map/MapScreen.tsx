import type { ReactElement } from 'react'
import { useState } from 'react'
import type { Route } from '../app/route.ts'
import type { CanvasTool, ProjectFile, Selection } from '../project/types.ts'
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
        <MapCanvas maps={project.maps} tool={tool}>
          <PinLayer
            maps={project.maps}
            dialogues={project.dialogues}
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

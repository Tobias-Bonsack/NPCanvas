import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import { CanvasLegend } from '../dialogue/CanvasLegend.tsx'
import { DialoguePanel } from '../dialogue/DialoguePanel.tsx'
import { dispatch } from '../project/store.ts'
import type { CanvasTool, GameMap, ProjectFile, Selection } from '../project/types.ts'
import type { Rect } from './geometry.ts'
import type { MapDragPreview } from './MapCanvas.tsx'
import { MapCanvas } from './MapCanvas.tsx'
import { MapImportButton } from './MapImportButton.tsx'
import { MapList } from './MapList.tsx'
import { PinLayer } from './PinLayer.tsx'
import './MapScreen.css'

type CanvasRoute = Extract<Route, { kind: 'canvas' }>

export function MapScreen({
  project,
  selection,
  route,
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
  // The culling input for the pin layer. It lives here rather than in `MapCanvas` because
  // both are children of this screen, and it changes only when the view settles — `setState`
  // is passed straight down, so the callback identity is stable for MapCanvas's effect.
  const [visibleRect, setVisibleRect] = useState<Rect | null>(null)

  // Identical to `project.maps` whenever no drag is in flight, so `PinLayer`'s memo holds
  // and panning still costs no pin render.
  const placedMaps = useMemo(() => withDragPreview(project.maps, mapDrag), [project.maps, mapDrag])

  // `replace`, because focusing is a one-shot intent the user never asked to keep in history
  // — and a stable identity, because the canvas consumes it from an effect.
  const dialogueId = route.dialogueId
  const onFocusApplied = useCallback(() => {
    navigate({ kind: 'canvas', dialogueId, focusMapId: null }, { replace: true })
  }, [dialogueId])

  // A cold load of #/canvas?dialogue=<id> arrives with the hash naming a dialogue and the
  // store's selection empty — `project/loaded` always starts at none. The hash is the intent,
  // so it is reconciled into the selection here. `selection/set` returns the identical state
  // when it changes nothing, which is what stops this from looping.
  //
  // An id naming a dialogue that no longer exists is dropped from the hash rather than left
  // pointing at nothing, the same correction `focus` gets in MapCanvas.
  const dialogues = project.dialogues
  useEffect(() => {
    if (dialogueId === null) return
    if (dialogues.some((dialogue) => dialogue.id === dialogueId)) {
      dispatch({ kind: 'selection/set', selection: { kind: 'dialogue', id: dialogueId } })
      return
    }
    navigate({ kind: 'canvas', dialogueId: null, focusMapId: null }, { replace: true })
  }, [dialogueId, dialogues])

  const selectedDialogue =
    selection.kind === 'dialogue'
      ? (dialogues.find((dialogue) => dialogue.id === selection.id) ?? null)
      : null

  // Closing is a deselection *and* a navigation: the hash carries the open panel, so leaving
  // the parameter behind would reopen it on the next render pass through the effect above.
  const onCloseDialogue = useCallback(() => {
    dispatch({ kind: 'selection/set', selection: { kind: 'none' } })
    navigate({ kind: 'canvas', dialogueId: null, focusMapId: null })
  }, [])

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
        <ToolPicker tool={tool} onChange={setTool} />
        <CanvasLegend />
      </header>
      <div className="map-screen__body">
        {/* A sidebar rather than a row in the bar: the list grows with the project, and it
            has to scroll on its own instead of pushing the canvas off screen. */}
        <aside className="map-screen__sidebar">
          <MapList project={project} />
        </aside>
        <div className="map-screen__canvas">
          <MapCanvas
            maps={placedMaps}
            tool={tool}
            selectedMapId={selection.kind === 'map' ? selection.id : null}
            focusMapId={route.focusMapId}
            onFocusApplied={onFocusApplied}
            onMapDrag={setMapDrag}
            onVisibleRectChange={setVisibleRect}
          >
            <PinLayer
              maps={placedMaps}
              dialogues={project.dialogues}
              selectedId={selection.kind === 'dialogue' ? selection.id : null}
              visibleRect={visibleRect}
            />
          </MapCanvas>
        </div>
        {selectedDialogue !== null && (
          <DialoguePanel
            project={project}
            dialogue={selectedDialogue}
            onClose={onCloseDialogue}
          />
        )}
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

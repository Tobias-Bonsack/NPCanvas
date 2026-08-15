import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import { CanvasLegend } from '../dialogue/CanvasLegend.tsx'
import { DialoguePanel } from '../dialogue/DialoguePanel.tsx'
import { dispatch } from '../project/store.ts'
import {
  dialoguesInAnyQuest,
  dialoguesInOpenQuests,
  indexQuestsByDialogue,
} from '../quest/quest-index.ts'
import type {
  CanvasTool,
  DialogueId,
  GameMap,
  ProjectFile,
  Selection,
  Zone,
} from '../project/types.ts'
import type { Rect } from './geometry.ts'
import type { MapDragPreview, ZoneDragPreview } from './MapCanvas.tsx'
import { MapCanvas } from './MapCanvas.tsx'
import { MapImportButton } from './MapImportButton.tsx'
import { MapList } from './MapList.tsx'
import { PinLayer } from './PinLayer.tsx'
import { ZoneLayer } from './ZoneLayer.tsx'
import { ZoneList } from './ZoneList.tsx'
import { countDialoguesByZone, dialoguesInZone, indexDialoguesByZone } from './zone-index.ts'
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
  // A zone drag in progress, held here for the same reason: the zone layer and everything
  // derived from the zones — labels, counts — must see the live polygon, and none of it
  // belongs in a document that autosaves.
  const [zoneDrag, setZoneDrag] = useState<ZoneDragPreview | null>(null)
  // The culling input for the pin layer. It lives here rather than in `MapCanvas` because
  // both are children of this screen, and it changes only when the view settles — `setState`
  // is passed straight down, so the callback identity is stable for MapCanvas's effect.
  const [visibleRect, setVisibleRect] = useState<Rect | null>(null)
  // Whether the canvas is filtered down to quest-linked pins. A view filter, not a document
  // property, so it lives here with the tool and the drag previews.
  const [questFilter, setQuestFilter] = useState(false)

  // Identical to `project.maps` whenever no drag is in flight, so `PinLayer`'s memo holds
  // and panning still costs no pin render.
  const placedMaps = useMemo(() => withDragPreview(project.maps, mapDrag), [project.maps, mapDrag])
  const drawnZones = useMemo(
    () => withZonePreview(project.zones, zoneDrag),
    [project.zones, zoneDrag],
  )

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

  // The derived locations, computed once per state change rather than per render — and keyed
  // on the *previewed* zones, so a zone being dragged reclassifies its dialogues live, with
  // no write to any of them. This is the whole payoff of never storing a zoneId.
  const zoneIndex = useMemo(
    () => indexDialoguesByZone(dialogues, drawnZones),
    [dialogues, drawnZones],
  )
  const zoneCounts = useMemo(() => countDialoguesByZone(zoneIndex), [zoneIndex])

  const selectedZoneId = selection.kind === 'zone' ? selection.id : null
  // `null` rather than an empty set when no zone is selected: "nothing to dim" and "this zone
  // is empty" must not look the same to the pin layer.
  const insideSelectedZone = useMemo(
    () => (selectedZoneId === null ? null : dialoguesInZone(zoneIndex, selectedZoneId)),
    [zoneIndex, selectedZoneId],
  )

  // Inverted once per document change, so the marker below is an O(1) lookup per pin rather
  // than a scan of every quest's dialogueIds per pin.
  const questIndex = useMemo(() => indexQuestsByDialogue(project.quests), [project.quests])
  const inOpenQuest = useMemo(() => dialoguesInOpenQuests(questIndex), [questIndex])
  const questLinked = useMemo(() => dialoguesInAnyQuest(questIndex), [questIndex])

  // The filters intersect rather than override: a selected zone and the quest highlight are
  // two independent questions, and answering only the most recent one would silently discard
  // half of what the user asked for. `null` when neither is active, so nothing dims at all.
  const highlighted = useMemo(
    () => intersect(insideSelectedZone, questFilter ? questLinked : null),
    [insideSelectedZone, questFilter, questLinked],
  )

  const selectedDialogue =
    selection.kind === 'dialogue'
      ? (dialogues.find((dialogue) => dialogue.id === selection.id) ?? null)
      : null

  // Resolved from the index in the order it returns — most specific zone first.
  const selectedLocations = useMemo(() => {
    if (selectedDialogue === null) return []
    const zoneIds = zoneIndex.get(selectedDialogue.id) ?? []
    return zoneIds.flatMap((id) => drawnZones.filter((zone) => zone.id === id))
  }, [selectedDialogue, zoneIndex, drawnZones])

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
        {/* Grouped, because both are controls that change what the canvas does; the legend on
            the far side only explains what is already drawn. */}
        <div className="map-screen__controls">
          <ToolPicker tool={tool} onChange={setTool} />
          <button
            type="button"
            className="quest-filter"
            aria-pressed={questFilter}
            disabled={questLinked.size === 0}
            title={
              questLinked.size === 0
                ? 'No dialogue is attached to a quest yet'
                : 'Dim every pin no quest names'
            }
            onClick={() => setQuestFilter((on) => !on)}
          >
            Quest pins only
          </button>
        </div>
        <CanvasLegend />
      </header>
      <div className="map-screen__body">
        {/* A sidebar rather than a row in the bar: the list grows with the project, and it
            has to scroll on its own instead of pushing the canvas off screen. */}
        <aside className="map-screen__sidebar">
          <MapList project={project} />
          <ZoneList project={project} selectedId={selectedZoneId} counts={zoneCounts} />
        </aside>
        <div className="map-screen__canvas">
          <MapCanvas
            maps={placedMaps}
            zones={drawnZones}
            tool={tool}
            selectedMapId={selection.kind === 'map' ? selection.id : null}
            focusMapId={route.focusMapId}
            onFocusApplied={onFocusApplied}
            onMapDrag={setMapDrag}
            onZoneDrag={setZoneDrag}
            onVisibleRectChange={setVisibleRect}
          >
            {/* Before the pins in the DOM, and therefore beneath them: a zone is the ground a
                dialogue was heard on, never something that can cover its pin. */}
            <ZoneLayer maps={placedMaps} zones={drawnZones} selectedId={selectedZoneId} />
            <PinLayer
              maps={placedMaps}
              dialogues={project.dialogues}
              selectedId={selection.kind === 'dialogue' ? selection.id : null}
              highlighted={highlighted}
              inOpenQuest={inOpenQuest}
              visibleRect={visibleRect}
            />
          </MapCanvas>
        </div>
        {selectedDialogue !== null && (
          <DialoguePanel
            project={project}
            dialogue={selectedDialogue}
            locations={selectedLocations}
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

/**
 * Both filters, or whichever one is active, or `null` when neither is — the single set the pin
 * layer dims against. Returns an operand by reference when it is the only one, so a canvas
 * with one filter running allocates nothing per render.
 */
function intersect(
  a: ReadonlySet<DialogueId> | null,
  b: ReadonlySet<DialogueId> | null,
): ReadonlySet<DialogueId> | null {
  if (a === null) return b
  if (b === null) return a
  const both = new Set<DialogueId>()
  for (const id of a) {
    if (b.has(id)) both.add(id)
  }
  return both
}

/** The zones as they should be drawn right now, mirroring `withDragPreview` exactly. */
function withZonePreview(zones: Zone[], drag: ZoneDragPreview | null): readonly Zone[] {
  if (drag === null) return zones
  return zones.map((zone) => (zone.id === drag.id ? { ...zone, polygon: drag.polygon } : zone))
}

const TOOLS: readonly { tool: CanvasTool; label: string; hint: string }[] = [
  { tool: { kind: 'inspect' }, label: 'Inspect', hint: 'Pan the canvas and select pins or zones' },
  {
    tool: { kind: 'place-dialogue' },
    label: 'Place dialogue',
    hint: 'Click a map to log a line',
  },
  {
    tool: { kind: 'draw-zone' },
    label: 'Draw zone',
    hint: 'Drag a rectangle on a map, or drag an existing zone to move it',
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

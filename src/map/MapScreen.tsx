import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import { clearSelection } from '../app/select.ts'
import type { CanvasViewState } from '../app/view-state.ts'
import { CanvasLegend } from '../dialogue/CanvasLegend.tsx'
import { DialoguePanel } from '../dialogue/DialoguePanel.tsx'
import { byId, questIndexFor } from '../project/derived.ts'
import { dispatch } from '../project/store.ts'
import { dialoguesInAnyQuest } from '../quest/quest-index.ts'
import type {
  CanvasTool,
  DialogueId,
  GameMap,
  PendingCaptureId,
  ProjectFile,
  RelevanceTagId,
  Selection,
  Zone,
} from '../project/types.ts'
import { CanvasDisplayDialog } from './CanvasDisplayDialog.tsx'
import { CapturesPanel } from './CapturesPanel.tsx'
import type { Rect } from './geometry.ts'
import type { MapDragPreview, ZoneDragPreview } from './MapCanvas.tsx'
import { MapCanvas } from './MapCanvas.tsx'
import type { Viewport } from './viewport.ts'
import { MapImportButton } from './MapImportButton.tsx'
import { MapList } from './MapList.tsx'
import type { PinDragPreview } from './PinLayer.tsx'
import { PinLayer } from './PinLayer.tsx'
import { ReferenceLayer } from './ReferenceLayer.tsx'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { TrailLayer } from './TrailLayer.tsx'
import { ZoneLayer } from './ZoneLayer.tsx'
import { ZoneList } from './ZoneList.tsx'
import {
  countDialoguesByZone,
  dialoguesInZone,
  indexDialoguesByZone,
  reindexMovedZone,
} from './zone-index.ts'
import './MapScreen.css'

type CanvasRoute = Extract<Route, { kind: 'canvas' }>

export function MapScreen({
  project,
  selection,
  route,
  viewState,
  onViewStateChange,
}: {
  project: ProjectFile
  selection: Selection
  route: CanvasRoute
  viewState: CanvasViewState
  onViewStateChange: (update: (prev: CanvasViewState) => CanvasViewState) => void
}): ReactElement {
  // Tool, quest filter and viewport are lifted to App so a switch away and back leaves the
  // canvas as it was. Setters below are stable functional updates, not closures over viewState.
  const { tool, questFilter, trail, references, mapsOpen, viewport, panelWidth } = viewState

  const [armedCaptureId, setArmedCaptureId] = useState<PendingCaptureId | null>(null)
  const [currentCaptureId, setCurrentCaptureId] = useState<PendingCaptureId | null>(null)
  // A dialog left open across a view switch is not a canvas setting, so this is a local
  // useState rather than a field of CanvasViewState.
  const [displayDialogOpen, setDisplayDialogOpen] = useState(false)
  const setTool = useCallback(
    (tool: CanvasTool) => {
      onViewStateChange((prev) => ({ ...prev, tool }))
      if (tool.kind !== 'place-dialogue') setArmedCaptureId(null)
    },
    [onViewStateChange],
  )
  // A toggle: clicking the already-armed row cancels it; arming another switches to place-dialogue.
  const onArmCapture = useCallback(
    (captureId: PendingCaptureId) => {
      if (armedCaptureId === captureId) {
        setArmedCaptureId(null)
        return
      }
      setArmedCaptureId(captureId)
      setTool({ kind: 'place-dialogue' })
    },
    [armedCaptureId, setTool],
  )
  // Auto-cancels rather than leaving a dangling arm: closing the panel or selecting elsewhere
  // means there is no longer a "points at" list on screen for a resolved click to land in.
  useEffect(() => {
    if (tool.kind !== 'pick-reference') return
    if (selection.kind === 'dialogue' && selection.id === tool.dialogueId) return
    setTool({ kind: 'inspect' })
  }, [tool, selection, setTool])

  const onStartPickReference = useCallback(
    (dialogueId: DialogueId) => setTool({ kind: 'pick-reference', dialogueId }),
    [setTool],
  )
  const onCancelPickReference = useCallback(() => setTool({ kind: 'inspect' }), [setTool])
  const onReferencePicked = useCallback(() => setTool({ kind: 'inspect' }), [setTool])

  const toggleQuestFilter = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, questFilter: !prev.questFilter })),
    [onViewStateChange],
  )
  const toggleTrail = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, trail: !prev.trail })),
    [onViewStateChange],
  )
  const toggleReferences = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, references: !prev.references })),
    [onViewStateChange],
  )
  const setViewport = useCallback(
    (viewport: Viewport) => onViewStateChange((prev) => ({ ...prev, viewport })),
    [onViewStateChange],
  )
  const setPanelWidth = useCallback(
    (panelWidth: number) => onViewStateChange((prev) => ({ ...prev, panelWidth })),
    [onViewStateChange],
  )

  // Read at the moment a resize gesture needs it, not cached — the window can be resized
  // between two drags.
  const bodyRef = useRef<HTMLDivElement>(null)
  const measureAvailableWidth = useCallback(
    () => bodyRef.current?.clientWidth ?? 0,
    [],
  )

  // Distinguishes "selected because it was just placed" (form claims focus) from every other
  // selection path (pin click, link, search — those want the pin itself focused).
  const [autoFocusDialogueId, setAutoFocusDialogueId] = useState<DialogueId | null>(null)
  const onDialoguePlaced = useCallback(
    (dialogueId: DialogueId) => {
      setAutoFocusDialogueId(dialogueId)
      setTool({ kind: 'inspect' }) // a stray next click must not create a second empty record
    },
    [setTool],
  )
  const onAutoFocusConsumed = useCallback(() => setAutoFocusDialogueId(null), [])

  // Read once at DialoguePanel mount, to decide whether it should move focus into itself or
  // leave it on the pin (which PinLayer's onPinSelected already focused).
  const [pinClickId, setPinClickId] = useState<DialogueId | null>(null)
  const onPinSelected = useCallback((dialogueId: DialogueId) => setPinClickId(dialogueId), [])

  // Lives here, above both world-space layers, so the image and its pins move together in the
  // same frame; kept out of the store since it would push a document-shaped update through
  // autosave every pointermove.
  const [mapDrag, setMapDrag] = useState<MapDragPreview | null>(null)
  const [zoneDrag, setZoneDrag] = useState<ZoneDragPreview | null>(null)
  // Narrower reason than mapDrag/zoneDrag: only TrailLayer reads this. PinLayer keeps rendering
  // the dragged pin from its own state so a preview-patched dialogues array never has to rebuild.
  const [pinDrag, setPinDrag] = useState<PinDragPreview | null>(null)
  const [visibleRect, setVisibleRect] = useState<Rect | null>(null)

  // Global, not scoped to the canvas: ToolPicker sits above it in the header bar.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTextFieldFocused()) return
      const entry = TOOLS.find((candidate) => candidate.key === event.key.toLowerCase())
      if (entry === undefined) return
      event.preventDefault()
      setTool(entry.tool)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setTool])

  const placedMaps = useMemo(() => withDragPreview(project.maps, mapDrag), [project.maps, mapDrag])
  const drawnZones = useMemo(
    () => withZonePreview(project.zones, zoneDrag),
    [project.zones, zoneDrag],
  )
  const zonesById = useMemo(() => byId(project.zones), [project.zones])

  // `replace`: focusing is a one-shot intent, not something to keep in history.
  const dialogueId = route.dialogueId
  const onFocusApplied = useCallback(() => {
    navigate({ kind: 'canvas', dialogueId, focus: null }, { replace: true })
  }, [dialogueId])

  // A cold #/canvas?dialogue=<id> load arrives with the store's selection still at none; the
  // hash is the intent, reconciled into the selection here. An unknown id is dropped from the
  // hash instead of left dangling.
  const dialogues = project.dialogues
  useEffect(() => {
    if (dialogueId === null) return
    if (dialogues.some((dialogue) => dialogue.id === dialogueId)) {
      dispatch({ kind: 'selection/set', selection: { kind: 'dialogue', id: dialogueId } })
      return
    }
    navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
  }, [dialogueId, dialogues])

  // The other half: writes a dialogue selection back to the route when the route doesn't
  // already carry it. Scoped to 'dialogue' — a zone/map selection has no route representation.
  useEffect(() => {
    if (dialogueId !== null) return
    if (selection.kind !== 'dialogue') return
    navigate({ kind: 'canvas', dialogueId: selection.id, focus: null }, { replace: true })
  }, [dialogueId, selection])

  // Built from the document's own zones and maps, not placedMaps — feeding a per-frame drag
  // array here would force a full rebuild per frame. A moved map reclassifies on release; a
  // zone drag stays live through reindexMovedZone below.
  const documentIndex = useMemo(
    () => indexDialoguesByZone(dialogues, project.zones, project.maps),
    [dialogues, project.zones, project.maps],
  )

  const zoneIndex = useMemo(
    () =>
      zoneDrag === null
        ? documentIndex
        : reindexMovedZone(documentIndex, dialogues, drawnZones, project.maps, zoneDrag.id),
    [documentIndex, dialogues, drawnZones, project.maps, zoneDrag],
  )
  const zoneCounts = useMemo(() => countDialoguesByZone(zoneIndex), [zoneIndex])

  const selectedZoneId = selection.kind === 'zone' ? selection.id : null
  // null, not an empty set, when no zone is selected — "nothing to dim" vs "this zone is empty".
  const insideSelectedZone = useMemo(
    () => (selectedZoneId === null ? null : dialoguesInZone(zoneIndex, selectedZoneId)),
    [zoneIndex, selectedZoneId],
  )

  const questIndex = useMemo(() => questIndexFor(project.quests), [project.quests])
  const questLinked = useMemo(() => dialoguesInAnyQuest(questIndex), [questIndex])

  // Memoized on relevanceTags' identity alone — a PinLayer prop must never change on anything
  // but a real document edit, or its memo boundary stops holding.
  const relevanceHueByTag = useMemo(
    () => new Map<RelevanceTagId, number>(project.relevanceTags.map((tag) => [tag.id, tag.hue])),
    [project.relevanceTags],
  )

  // Intersect, not override — a selected zone and the quest highlight are independent questions.
  const highlighted = useMemo(
    () => intersect(insideSelectedZone, questFilter ? questLinked : null),
    [insideSelectedZone, questFilter, questLinked],
  )

  const selectedDialogue =
    selection.kind === 'dialogue'
      ? (dialogues.find((dialogue) => dialogue.id === selection.id) ?? null)
      : null

  const selectedLocations = useMemo(() => {
    if (selectedDialogue === null) return []
    const zoneIds = zoneIndex.get(selectedDialogue.id) ?? []
    return zoneIds.flatMap((id) => drawnZones.filter((zone) => zone.id === id))
  }, [selectedDialogue, zoneIndex, drawnZones])

  // Deselection and navigation together: the hash carries the open panel.
  const onCloseDialogue = useCallback(() => {
    clearSelection()
  }, [])

  if (project.maps.length === 0) {
    return (
      <section className="map-screen map-screen--empty">
        <div className="map-screen__cta">
          <h1 className="map-screen__title">Import a map</h1>
          <p className="lead-text">
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
      {displayDialogOpen && (
        <CanvasDisplayDialog
          questFilter={questFilter}
          onToggleQuestFilter={toggleQuestFilter}
          questFilterDisabled={questLinked.size === 0}
          trail={trail}
          onToggleTrail={toggleTrail}
          trailDisabled={project.dialogues.length < 2}
          references={references}
          onToggleReferences={toggleReferences}
          referencesDisabled={!project.dialogues.some((dialogue) => dialogue.references.length > 0)}
          onClose={() => setDisplayDialogOpen(false)}
        />
      )}
      <div className="map-screen__body" ref={bodyRef}>
        <aside className="map-screen__sidebar">
          <h1 className="visually-hidden">Canvas</h1>
          <div className="map-screen__tools">
            <button type="button" className="button" onClick={() => setDisplayDialogOpen(true)}>
              Display…
            </button>
            <ToolPicker tool={tool} onChange={setTool} />
          </div>
          <ZoneList project={project} selectedId={selectedZoneId} counts={zoneCounts} />
          <details
            className="map-list-disclosure"
            open={mapsOpen}
            // Read synchronously, not inside the updater below — currentTarget reverts to null
            // once the native event finishes dispatching, before a setState updater runs.
            onToggle={(event) => {
              const open = event.currentTarget.open
              onViewStateChange((prev) => ({ ...prev, mapsOpen: open }))
            }}
          >
            <summary className="map-list-disclosure__summary micro-label disclosure-summary">
              Maps
            </summary>
            <MapList project={project} />
          </details>
          <CanvasLegend relevanceTags={project.relevanceTags} />
        </aside>
        <div className="map-screen__canvas">
          <MapCanvas
            maps={placedMaps}
            zones={drawnZones}
            dialogues={project.dialogues}
            selection={selection}
            tool={tool}
            selectedMapId={selection.kind === 'map' ? selection.id : null}
            focus={route.focus}
            onFocusApplied={onFocusApplied}
            onMapDrag={setMapDrag}
            onZoneDrag={setZoneDrag}
            onVisibleRectChange={setVisibleRect}
            onDialoguePlaced={onDialoguePlaced}
            armedCaptureId={armedCaptureId}
            initialViewport={viewport}
            onViewportChange={setViewport}
          >
            <ZoneLayer
              maps={placedMaps}
              zones={drawnZones}
              selectedId={selectedZoneId}
              visibleRect={visibleRect}
            />
            {trail && (
              <TrailLayer
                maps={placedMaps}
                dialogues={project.dialogues}
                highlighted={highlighted}
                pinDrag={pinDrag}
              />
            )}
            {references && (
              <ReferenceLayer
                maps={placedMaps}
                dialogues={project.dialogues}
                highlighted={highlighted}
                pinDrag={pinDrag}
              />
            )}
            <PinLayer
              maps={placedMaps}
              dialogues={project.dialogues}
              selectedId={selection.kind === 'dialogue' ? selection.id : null}
              highlighted={highlighted}
              questsByDialogue={questIndex}
              relevanceHueByTag={relevanceHueByTag}
              visibleRect={visibleRect}
              suppressFocusId={autoFocusDialogueId}
              pickReferenceFor={tool.kind === 'pick-reference' ? tool.dialogueId : null}
              onReferencePicked={onReferencePicked}
              onPinSelected={onPinSelected}
              onPinDrag={setPinDrag}
            />
          </MapCanvas>
        </div>
        {selectedDialogue !== null ? (
          <DialoguePanel
            project={project}
            dialogue={selectedDialogue}
            locations={selectedLocations}
            zonesById={zonesById}
            zoneIndex={zoneIndex}
            onClose={onCloseDialogue}
            autoFocusNpc={autoFocusDialogueId === selectedDialogue.id}
            onAutoFocusConsumed={onAutoFocusConsumed}
            openedFromPin={pinClickId === selectedDialogue.id}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            measureAvailableWidth={measureAvailableWidth}
            pickingReference={tool.kind === 'pick-reference' && tool.dialogueId === selectedDialogue.id}
            onStartPickReference={onStartPickReference}
            onCancelPickReference={onCancelPickReference}
          />
        ) : (
          <CapturesPanel
            project={project}
            armedCaptureId={armedCaptureId}
            onArm={onArmCapture}
            currentCaptureId={currentCaptureId}
            onSelect={setCurrentCaptureId}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            measureAvailableWidth={measureAvailableWidth}
          />
        )}
      </div>
    </section>
  )
}

// Returns the original array when nothing is being dragged — a fresh array every render would
// defeat PinLayer's memo.
function withDragPreview(maps: GameMap[], drag: MapDragPreview | null): readonly GameMap[] {
  if (drag === null) return maps
  return maps.map((map) => (map.id === drag.id ? { ...map, origin: drag.origin } : map))
}

// Returns an operand by reference when it's the only one active, so one filter allocates nothing.
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

function withZonePreview(zones: Zone[], drag: ZoneDragPreview | null): readonly Zone[] {
  if (drag === null) return zones
  return zones.map((zone) => (zone.id === drag.id ? { ...zone, polygon: drag.polygon } : zone))
}

// T['id'], not a second type parameter — a key parameter is only inferable from the
// constraint, which lands as `unknown` and throws away the brand.
// `key` is a single unmodified letter — matched by the global listener above and printed by
// ToolPicker's button (#42's "discoverable without documentation").
const TOOLS: readonly { tool: CanvasTool; label: string; hint: string; key: string }[] = [
  {
    tool: { kind: 'inspect' },
    label: 'Inspect',
    hint: 'Pan the canvas and select pins or zones',
    key: 'i',
  },
  {
    tool: { kind: 'place-dialogue' },
    label: 'Place dialogue',
    hint: 'Click a map to log a line',
    key: 'p',
  },
  {
    tool: { kind: 'draw-zone' },
    label: 'Draw zone',
    hint: 'Drag out a rectangle, drag a zone to move it, or its grips to resize it',
    key: 'z',
  },
  {
    tool: { kind: 'move-map' },
    label: 'Move map',
    hint: 'Drag a map to arrange the canvas',
    key: 'm',
  },
]

// radiogroup/radio, not plain group — roving tabindex makes the tools keyboard-reachable like a
// native radio group.
function ToolPicker({
  tool,
  onChange,
}: {
  tool: CanvasTool
  onChange: (tool: CanvasTool) => void
}): ReactElement {
  const buttons = useRef<Partial<Record<CanvasTool['kind'], HTMLButtonElement | null>>>({})

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    const step = arrowStep(event.key)
    if (step === null) return
    event.preventDefault()
    const next = TOOLS[(index + step + TOOLS.length) % TOOLS.length]
    onChange(next.tool)
    buttons.current[next.tool.kind]?.focus()
  }

  return (
    <div className="tool-picker" role="radiogroup" aria-label="Canvas tool" aria-orientation="vertical">
      {TOOLS.map((entry, index) => (
        <button
          key={entry.tool.kind}
          ref={(element) => {
            buttons.current[entry.tool.kind] = element
          }}
          type="button"
          role="radio"
          className="tool-picker__button segmented-button"
          aria-checked={entry.tool.kind === tool.kind}
          tabIndex={entry.tool.kind === tool.kind ? 0 : -1}
          title={`${entry.hint} (${entry.key.toUpperCase()})`}
          onClick={() => onChange(entry.tool)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {entry.label} <span className="tool-picker__key">{entry.key.toUpperCase()}</span>
        </button>
      ))}
    </div>
  )
}

function arrowStep(key: string): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1
  return null
}

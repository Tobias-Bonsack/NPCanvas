import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import type { CanvasViewState } from '../app/view-state.ts'
import { CanvasLegend } from '../dialogue/CanvasLegend.tsx'
import { DialoguePanel } from '../dialogue/DialoguePanel.tsx'
import { dispatch } from '../project/store.ts'
import { dialoguesInAnyQuest, indexQuestsByDialogue } from '../quest/quest-index.ts'
import type {
  CanvasTool,
  DialogueId,
  GameMap,
  ProjectFile,
  RelevanceTagId,
  Selection,
  Zone,
} from '../project/types.ts'
import type { Rect } from './geometry.ts'
import type { MapDragPreview, ZoneDragPreview } from './MapCanvas.tsx'
import { MapCanvas } from './MapCanvas.tsx'
import type { Viewport } from './viewport.ts'
import { MapImportButton } from './MapImportButton.tsx'
import { MapList } from './MapList.tsx'
import type { PinDragPreview } from './PinLayer.tsx'
import { PinLayer } from './PinLayer.tsx'
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
  // Tool, quest filter and viewport are lifted to `App` so a switch away and back leaves the
  // canvas exactly as it was — see CLAUDE.md's view-state note. Every setter below is a stable
  // functional update rather than a closure over `viewState`, which is what keeps the global
  // keydown listener correct without needing `viewState` itself in its dependency list.
  const { tool, questFilter, trail, viewport, panelWidth } = viewState
  const setTool = useCallback(
    (tool: CanvasTool) => onViewStateChange((prev) => ({ ...prev, tool })),
    [onViewStateChange],
  )
  const toggleQuestFilter = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, questFilter: !prev.questFilter })),
    [onViewStateChange],
  )
  const toggleTrail = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, trail: !prev.trail })),
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

  // The width the panel and the canvas share, read at the moment a resize gesture needs it
  // rather than kept in state: the window can be resized between two drags, and a cached
  // number would clamp the second one against the first one's window.
  const bodyRef = useRef<HTMLDivElement>(null)
  const measureAvailableWidth = useCallback(
    () => bodyRef.current?.clientWidth ?? 0,
    [],
  )

  // The dialogue a `place-dialogue` click just created, until its form has claimed the focus it
  // is owed. Distinguishes "selected because it was just placed" from every other way a
  // dialogue gets selected (a pin click, a link, the search palette) — those still want the pin
  // itself focused, which is `PinLayer`'s own effect and stays untouched. Component state, not
  // the store: it is exactly as transient as `tool`, and neither belongs in `data.json`.
  const [autoFocusDialogueId, setAutoFocusDialogueId] = useState<DialogueId | null>(null)
  const onDialoguePlaced = useCallback(
    (dialogueId: DialogueId) => {
      setAutoFocusDialogueId(dialogueId)
      // A stray next click must not create a second empty record.
      setTool({ kind: 'inspect' })
    },
    [setTool],
  )
  // Called once the form's autofocus has actually run — see `DialogueForm`. Clearing it is what
  // stops a *later* reselection of the same dialogue from re-stealing focus from its pin.
  const onAutoFocusConsumed = useCallback(() => setAutoFocusDialogueId(null), [])

  // The dialogue a pin's own pointerup last selected — see `PinLayer`'s `onPinSelected`. Read
  // once, at the moment `DialoguePanel` mounts, to decide whether the panel should move focus
  // into itself (every other way in) or leave it on the pin, which has already focused itself.
  const [pinClickId, setPinClickId] = useState<DialogueId | null>(null)
  const onPinSelected = useCallback((dialogueId: DialogueId) => setPinClickId(dialogueId), [])

  // A map drag in progress. It lives here, above both world-space layers, because the image
  // and its pins have to move together in the same frame — and it stays out of the store,
  // which would push a document-shaped update through autosave on every pointermove.
  const [mapDrag, setMapDrag] = useState<MapDragPreview | null>(null)
  // A zone drag in progress, held here for the same reason: the zone layer and everything
  // derived from the zones — labels, counts — must see the live polygon, and none of it
  // belongs in a document that autosaves.
  const [zoneDrag, setZoneDrag] = useState<ZoneDragPreview | null>(null)
  // And a pin drag, held here for a narrower reason: only `TrailLayer` reads it. `PinLayer` keeps
  // rendering the dragged pin from its own state and keeps receiving `project.dialogues`, because
  // a preview-patched array would be new every frame and rebuild its per-map buckets.
  const [pinDrag, setPinDrag] = useState<PinDragPreview | null>(null)
  // The culling input for the pin layer. It lives here rather than in `MapCanvas` because
  // both are children of this screen, and it changes only when the view settles — `setState`
  // is passed straight down, so the callback identity is stable for MapCanvas's effect.
  const [visibleRect, setVisibleRect] = useState<Rect | null>(null)

  // Global, not scoped to the canvas: `ToolPicker` sits in the header bar above it, so a
  // listener on the canvas container alone would never see these. Guarded on a text field the
  // same way `MapCanvas`'s own shortcuts are, since an unmodified letter is exactly what a
  // dialogue's NPC name or a zone rename is made of.
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
    navigate({ kind: 'canvas', dialogueId, focus: null }, { replace: true })
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
    navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
  }, [dialogueId, dialogues])

  // The derived locations, computed once per state change rather than per render. Built from
  // the document's own zones *and* its own maps, so neither a zone drag nor a map drag touches it
  // for the length of the gesture — `placedMaps` is a new array every frame, and feeding it here
  // would force a full O(dialogues x zones) rebuild per frame for a layout move. A map dropped
  // over a zone reclassifies its pins on release; a zone drag stays live through the reindex
  // below, which is the gesture whose whole point is watching membership change.
  const documentIndex = useMemo(
    () => indexDialoguesByZone(dialogues, project.zones, project.maps),
    [dialogues, project.zones, project.maps],
  )

  // A zone being dragged still reclassifies its dialogues live, with no write to any of them —
  // that is the whole payoff of never storing a zoneId. What changed is the cost: one zone's
  // membership re-tested against the pins of every map it reaches, applied to the index above,
  // instead of an O(dialogues x zones) rebuild on every frame.
  const zoneIndex = useMemo(
    () =>
      zoneDrag === null
        ? documentIndex
        : reindexMovedZone(documentIndex, dialogues, drawnZones, project.maps, zoneDrag.id),
    [documentIndex, dialogues, drawnZones, project.maps, zoneDrag],
  )
  const zoneCounts = useMemo(() => countDialoguesByZone(zoneIndex), [zoneIndex])

  const selectedZoneId = selection.kind === 'zone' ? selection.id : null
  // `null` rather than an empty set when no zone is selected: "nothing to dim" and "this zone
  // is empty" must not look the same to the pin layer.
  const insideSelectedZone = useMemo(
    () => (selectedZoneId === null ? null : dialoguesInZone(zoneIndex, selectedZoneId)),
    [zoneIndex, selectedZoneId],
  )

  // Inverted once per document change, so a pin's flags are an O(1) lookup rather than a scan
  // of every quest's dialogueIds per pin. Memoized on `project.quests` alone, which is what
  // keeps it stable across pan frames and `PinLayer`'s memo intact.
  const questIndex = useMemo(() => indexQuestsByDialogue(project.quests), [project.quests])
  const questLinked = useMemo(() => dialoguesInAnyQuest(questIndex), [questIndex])

  // Built once per document change, on the identity of `project.relevanceTags` alone — see
  // CLAUDE.md's `World-space layers` note: a `PinLayer` prop must never change on anything but a
  // real document edit, or the memo that keeps panning free stops holding.
  const relevanceHueByTag = useMemo(
    () => new Map<RelevanceTagId, number>(project.relevanceTags.map((tag) => [tag.id, tag.hue])),
    [project.relevanceTags],
  )

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
    navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
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
          <MapImportButton label="Choose a map image" />
        </div>
      </section>
    )
  }

  return (
    <section className="map-screen">
      <header className="map-screen__bar">
        {/* Visually hidden: the bar is already dense with controls, and "Canvas" would say
            nothing a sighted user does not already see from the map itself. The other two
            views print a visible title because they open on a page of text; this one opens on
            a picture. Still a real heading — the one thing every view needs regardless. */}
        <h1 className="visually-hidden">Canvas</h1>
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
            onClick={toggleQuestFilter}
          >
            Quest pins only
          </button>
          {/* Sits beside the quest filter because both change what the canvas draws, but it is a
              layer rather than a filter: it adds the order the pins were heard in without
              touching which of them are dimmed. */}
          <button
            type="button"
            className="trail-toggle"
            aria-pressed={trail}
            disabled={project.dialogues.length < 2}
            title={
              project.dialogues.length < 2
                ? 'Two lines have to be logged before there is an order to draw'
                : 'Draw a line through the pins, earliest line to latest'
            }
            onClick={toggleTrail}
          >
            Time trail
          </button>
        </div>
        <CanvasLegend relevanceTags={project.relevanceTags} />
      </header>
      <div className="map-screen__body" ref={bodyRef}>
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
            initialViewport={viewport}
            onViewportChange={setViewport}
          >
            {/* Before the pins in the DOM, and therefore beneath them: a zone is the ground a
                dialogue was heard on, never something that can cover its pin. */}
            <ZoneLayer
              maps={placedMaps}
              zones={drawnZones}
              selectedId={selectedZoneId}
              visibleRect={visibleRect}
            />
            {/* Between the two, so the line runs over the ground a dialogue was heard on and
                under the pins it threads. */}
            {trail && (
              <TrailLayer
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
              onPinSelected={onPinSelected}
              onPinDrag={setPinDrag}
            />
          </MapCanvas>
        </div>
        {selectedDialogue !== null && (
          <DialoguePanel
            project={project}
            dialogue={selectedDialogue}
            locations={selectedLocations}
            onClose={onCloseDialogue}
            autoFocusNpc={autoFocusDialogueId === selectedDialogue.id}
            onAutoFocusConsumed={onAutoFocusConsumed}
            openedFromPin={pinClickId === selectedDialogue.id}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            measureAvailableWidth={measureAvailableWidth}
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

/**
 * `key` is a single letter, unmodified — see the global listener in `MapScreen` — and it is
 * also what `ToolPicker` prints on the button, per #42's "discoverable without documentation".
 */
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

/**
 * A mutually exclusive set, so `radiogroup`/`radio` is the correct role — not the plain
 * `group` this used to carry — and roving tabindex is what makes the tools reachable by
 * keyboard at all: Tab lands once, on whichever is checked, and the arrows move both the
 * selection and the focus together, exactly like a native radio group.
 */
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
    <div className="tool-picker" role="radiogroup" aria-label="Canvas tool">
      {TOOLS.map((entry, index) => (
        <button
          key={entry.tool.kind}
          ref={(element) => {
            buttons.current[entry.tool.kind] = element
          }}
          type="button"
          role="radio"
          className="tool-picker__button"
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

/** `ArrowRight`/`ArrowDown` move forward, `ArrowLeft`/`ArrowUp` back; anything else is `null`. */
function arrowStep(key: string): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1
  return null
}

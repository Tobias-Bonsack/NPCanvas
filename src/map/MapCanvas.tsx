import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assertNever } from '../assert-never.ts'
import { clearSelection, selectDialogue, selectMap, selectZone } from '../app/select.ts'
import { newDialogueId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type {
  CanvasTool,
  Dialogue,
  DialogueId,
  GameMap,
  MapId,
  PendingCaptureId,
  Point,
  Selection,
  Zone,
} from '../project/types.ts'
import type { FocusTarget } from '../app/route.ts'
import {
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
  canvasToMapLocal,
  clampMapScale,
  mapAtCanvasPoint,
  mapCanvasRect,
  mapsBounds,
  zoneAtCanvasPoint,
  zoneCanvasRect,
} from './canvas-layout.ts'
import type { Rect, Size } from './geometry.ts'
import { inflate, translatePolygon } from './geometry.ts'
import { MapImage } from './MapImage.tsx'
import { mapGroupStyle } from './map-group-style.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import type { MapDragApi, MapDragPreview } from './use-map-drag.ts'
import { useMapDrag } from './use-map-drag.ts'
import type { PanGestureApi } from './use-pan-gesture.ts'
import { usePanGesture } from './use-pan-gesture.ts'
import type { ZoneDragPreview, ZoneToolApi } from './use-zone-tool.ts'
import { minZoneSizeIn, useZoneTool } from './use-zone-tool.ts'
import type { Viewport } from './viewport.ts'
import { fitRectToContainer, screenToWorld, visibleWorldRect, zoomAt } from './viewport.ts'
import { normalizeDelta, wheelZoomFactor } from './wheel-zoom.ts'
import { resizePolygon, zoneHandlePoints } from './zone-resize.ts'
import './MapCanvas.css'

export type { MapDragPreview } from './use-map-drag.ts'
export type { ZoneDragPreview } from './use-zone-tool.ts'

// World-space layers must stay viewport-independent (CLAUDE.md), so the visible rect republishes
// only once a gesture settles rather than every frame.
const SETTLE_MS = 150

// A pin's marker extends past its point, so an exact visible rect would show a half-visible pin
// a glyph while its neighbour a pixel inside shows a thumbnail.
const CULL_MARGIN = 0.15

const EMPTY_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }

const SCALE_STEP = 1.25

// Below this zoom, a pin's label is more likely than not to overlap its neighbour's — see #95,
// measured against overlapping labels at 13% `Fit` zoom in the test project.
const PIN_LABEL_ZOOM_THRESHOLD = 0.5

const NOTICE_MS = 4000

const PAN_STEP = 48
const PAN_STEP_FAST = 8

const NUDGE_STEP = 1
const NUDGE_STEP_FAST = 10

// Controls layered over the map carry data-canvas-ui; a press starting inside one is that
// control's business, not a canvas gesture. Without this the container would capture the
// pointer and retarget click to itself, so the button's own onClick never runs.
function isCanvasChrome(target: EventTarget): boolean {
  return target instanceof Element && target.closest('[data-canvas-ui]') !== null
}

// Takes the container's client origin rather than measuring it here — this runs on every wheel
// event and pointermove, and getBoundingClientRect() would force a layout flush per frame.
function anchorOf(event: { clientX: number; clientY: number }, origin: Point): Point {
  return { x: event.clientX - origin.x, y: event.clientY - origin.y }
}

// `null` for a focus target naming a map or zone since deleted — treated as nothing to jump to.
function focusRect(
  focus: FocusTarget,
  maps: readonly GameMap[],
  zones: readonly Zone[],
): Rect | null {
  if (focus.kind === 'map') {
    const map = maps.find((candidate) => candidate.id === focus.id)
    return map === undefined ? null : mapCanvasRect(map)
  }
  const zone = zones.find((candidate) => candidate.id === focus.id)
  if (zone === undefined) return null
  const map = maps.find((candidate) => candidate.id === zone.mapId)
  return map === undefined ? null : zoneCanvasRect(map, zone)
}

type CanvasViewportApi = {
  container: Size
  viewport: Viewport
  viewportRef: { current: Viewport }
  containerOrigin: { current: Point }
  applyViewport: (next: Viewport) => void
  fitToMaps: () => void
  zoomByFactor: (factor: number) => void
  zoomToOne: () => void
  panBy: (direction: Point, step: number) => void
}

// The viewport machinery every gesture reads and none of them owns: measured size, the live
// Viewport, fit-to-maps, and the settle timer that republishes viewport + visible rect once a
// gesture stops rather than every frame (CLAUDE.md's viewport-independence rule).
function useCanvasViewport({
  containerRef,
  maps,
  zones,
  focus,
  onFocusApplied,
  initialViewport,
  onViewportChange,
  onVisibleRectChange,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  maps: readonly GameMap[]
  zones: readonly Zone[]
  focus: FocusTarget | null
  onFocusApplied: () => void
  initialViewport: Viewport | null
  onViewportChange: (viewport: Viewport) => void
  onVisibleRectChange: (rect: Rect) => void
}): CanvasViewportApi {
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Viewport>(() => initialViewport ?? EMPTY_VIEWPORT)
  const viewportRef = useRef<Viewport>(viewport)
  // Cached because it only changes on resize but is read on every wheel/click/pointermove —
  // measuring there would force a layout flush per frame.
  const containerOrigin = useRef<Point>({ x: 0, y: 0 })

  const applyViewport = useCallback((next: Viewport): void => {
    viewportRef.current = next
    setViewport(next)
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      const bounds = element.getBoundingClientRect()
      containerOrigin.current = { x: bounds.left, y: bounds.top }
      setContainer({ width: box.width, height: box.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [containerRef])

  // .map-canvas is overflow:hidden but still scrollable — focusing an off-screen descendant can
  // set scrollLeft/scrollTop, which every coordinate conversion here (measured from
  // containerOrigin) would then be permanently off by. This is the backstop beyond PinLayer's
  // own preventScroll.
  useEffect(() => {
    const element = containerRef.current
    if (element === null) return
    const onScroll = (): void => {
      element.scrollLeft = 0
      element.scrollTop = 0
    }
    element.addEventListener('scroll', onScroll)
    return () => element.removeEventListener('scroll', onScroll)
  }, [containerRef])

  // Fitting against a container not yet laid out divides by zero; a project with no maps still
  // resets so the button can undo a pan across empty canvas.
  function fitToMaps(): void {
    if (container.width === 0 || container.height === 0) return
    const bounds = mapsBounds(maps)
    applyViewport(bounds === null ? EMPTY_VIEWPORT : fitRectToContainer(bounds, container))
  }

  // Fit once, on the first real measurement — not on every resize or map change. Already true
  // when a viewport was restored, so a switch back to the canvas lands where the user left it.
  const fitted = useRef(initialViewport !== null)
  useEffect(() => {
    if (fitted.current) return
    if (container.width === 0 || container.height === 0) return
    const bounds = mapsBounds(maps)
    if (bounds === null) return
    fitted.current = true
    applyViewport(fitRectToContainer(bounds, container))
  }, [maps, container, applyViewport])

  // One-shot: consumed and cleared even for an unknown id, so a stale hash target never sticks.
  useEffect(() => {
    if (focus === null) return
    if (container.width === 0 || container.height === 0) return
    const rect = focusRect(focus, maps, zones)
    if (rect !== null) {
      fitted.current = true // suppress the fit-on-mount above — land on the target, not fit-then-jump
      applyViewport(fitRectToContainer(rect, container))
    }
    onFocusApplied()
  }, [focus, maps, zones, container, onFocusApplied, applyViewport])

  // Every viewport change restarts the timer, so a pan or zoom publishes exactly once, on stop —
  // a per-frame onViewportChange would re-render MapScreen on every pointermove.
  useEffect(() => {
    if (container.width === 0 || container.height === 0) return
    const timer = setTimeout(() => {
      onVisibleRectChange(inflate(visibleWorldRect(viewport, container), CULL_MARGIN))
      onViewportChange(viewport)
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [viewport, container, onVisibleRectChange, onViewportChange])

  // Bound by hand with { passive: false }: React's onWheel is passive, so preventDefault()
  // there silently does nothing and the page scrolls instead of the map zooming.
  useEffect(() => {
    // An arrow const, not a function declaration, so `element`'s null-check narrowing applies.
    const element = containerRef.current
    if (element === null) return

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      // shiftKey is the scroll-to-pan a trackpad keeps; otherwise the wheel zooms — see wheel-zoom.ts.
      if (!event.shiftKey) {
        const anchor = anchorOf(event, containerOrigin.current)
        applyViewport(zoomAt(viewportRef.current, anchor, wheelZoomFactor(event)))
        return
      }

      const delta = normalizeDelta(event)
      const view = viewportRef.current
      applyViewport({
        x: view.x + delta.x / view.scale,
        y: view.y + delta.y / view.scale,
        scale: view.scale,
      })
    }

    element.addEventListener('wheel', onWheel, { passive: false })

    return () => element.removeEventListener('wheel', onWheel)
  }, [containerRef, applyViewport])

  function zoomByFactor(factor: number): void {
    if (container.width === 0 || container.height === 0) return
    const anchor = { x: container.width / 2, y: container.height / 2 }
    applyViewport(zoomAt(viewportRef.current, anchor, factor))
  }

  function zoomToOne(): void {
    zoomByFactor(1 / viewportRef.current.scale)
  }

  function panBy(direction: Point, step: number): void {
    const view = viewportRef.current
    applyViewport({
      x: view.x + (direction.x * step) / view.scale,
      y: view.y + (direction.y * step) / view.scale,
      scale: view.scale,
    })
  }

  return {
    container,
    viewport,
    viewportRef,
    containerOrigin,
    applyViewport,
    fitToMaps,
    zoomByFactor,
    zoomToOne,
    panBy,
  }
}

type MapCanvasProps = {
  maps: readonly GameMap[]
  zones: readonly Zone[]
  dialogues: readonly Dialogue[]
  selection: Selection
  tool: CanvasTool
  selectedMapId: MapId | null
  focus: FocusTarget | null
  onFocusApplied: () => void
  onMapDrag: (preview: MapDragPreview | null) => void
  onZoneDrag: (preview: ZoneDragPreview | null) => void
  onVisibleRectChange: (rect: Rect) => void
  /** Fires once a placement lands — see #45 for why MapScreen moves focus off the pin. */
  onDialoguePlaced: (dialogueId: DialogueId) => void
  /** When set, a place-dialogue click dispatches pending-capture/placed instead of a fresh Dialogue. */
  armedCaptureId: PendingCaptureId | null
  /** Read only at mount; this component owns the live value after and reports via onViewportChange. */
  initialViewport: Viewport | null
  onViewportChange: (viewport: Viewport) => void
  children?: ReactNode
}

// DOM under one CSS transform, not <canvas> (CLAUDE.md). Viewport is component state, not store
// state — putting it in the store would push a document-shaped update through autosave on every
// pointermove. Pan, the zone tool, and map drag are each their own hook; this component
// arbitrates which one a press belongs to and owns what's common (viewport, settle timer, notice).
export function MapCanvas({
  maps,
  zones,
  dialogues,
  selection,
  tool,
  selectedMapId,
  focus,
  onFocusApplied,
  onMapDrag,
  onZoneDrag,
  onVisibleRectChange,
  onDialoguePlaced,
  armedCaptureId,
  initialViewport,
  onViewportChange,
  children,
}: MapCanvasProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const { viewport, viewportRef, containerOrigin, applyViewport, fitToMaps, zoomByFactor, zoomToOne, panBy } =
    useCanvasViewport({
      containerRef,
      maps,
      zones,
      focus,
      onFocusApplied,
      initialViewport,
      onViewportChange,
      onVisibleRectChange,
    })
  // Drives will-change on the world element for a gesture that repaints every frame (pan, map
  // drag, zone drag) and no longer — see .map-canvas[data-panning] in MapCanvas.css.
  const [panning, setPanning] = useState(false)
  // Nonced rather than compared by text, so the same rejection twice restarts the notice timer.
  const [notice, setNotice] = useState<{ nonce: number; text: string } | null>(null)
  const nextNotice = useRef(0)
  const selectedMap = useMemo(
    () => maps.find((map) => map.id === selectedMapId) ?? null,
    [maps, selectedMapId],
  )

  const selectedZone = useMemo(() => {
    if (selection.kind !== 'zone') return null
    const zone = zones.find((candidate) => candidate.id === selection.id)
    if (zone === undefined) return null
    const map = maps.find((candidate) => candidate.id === zone.mapId)
    return map === undefined ? null : { zone, map }
  }, [selection, zones, maps])

  function showNotice(text: string): void {
    nextNotice.current += 1
    setNotice({ nonce: nextNotice.current, text })
  }

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const pan: PanGestureApi = usePanGesture({ viewportRef, applyViewport, setPanning })
  const zoneTool: ZoneToolApi = useZoneTool({
    maps,
    zones,
    selectedZone,
    viewportRef,
    setPanning,
    onZoneDrag,
    showNotice,
  })
  const mapDrag: MapDragApi = useMapDrag({ tool, viewportRef, containerOrigin, setPanning, onMapDrag })

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    if (isCanvasChrome(event.target)) return
    // A press arriving while the canvas already owns a pointer is ignored rather than
    // replacing the gesture in flight; `beginDrag` guards each ref, this guards the pair.
    if (pan.ref.current !== null || zoneTool.ref.current !== null) return
    const anchor = anchorOf(event, containerOrigin.current)
    // A press on bare canvas falls through to a pan, so the canvas stays navigable.
    if (tool.kind === 'draw-zone' && zoneTool.begin(event, anchor)) return
    pan.begin(event, anchor)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const anchor = anchorOf(event, containerOrigin.current)
    if (zoneTool.ref.current !== null) {
      zoneTool.move(event, anchor)
      return
    }
    pan.move(event, anchor)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return // ignore a right-button release during a held left-press
    if (zoneTool.ref.current !== null) {
      zoneTool.end(event)
      return
    }
    const end = pan.end(event)
    if (end === null || end.moved) return

    // The current viewport, not the one the press started against — a wheel notch mid-press
    // would otherwise place the pin at the stale pre-zoom world point.
    onCanvasClick(anchorOf(event, containerOrigin.current), viewportRef.current)
  }

  // Neither gesture dispatches anything on cancel — every preview is dropped.
  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    pan.cancel(event)
    zoneTool.cancel(event)
  }

  function onCanvasClick(anchor: Point, at: Viewport): void {
    handleCanvasClick(anchor, at, { maps, zones, tool, armedCaptureId, onDialoguePlaced, showNotice })
  }

  // isTextFieldFocused is a second guard for a future overlay inside this subtree — React's own
  // bubbling already keeps this from firing while focus is in DialoguePanel or a sidebar input.
  function onCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    handleCanvasKeyDown(event, {
      selection,
      dialogues,
      zones,
      selectedZone,
      viewport: viewportRef.current,
      zoomByFactor,
      zoomToOne,
      fitToMaps,
      panBy,
    })
  }

  return (
    <div
      className="map-canvas"
      data-tool={tool.kind}
      data-panning={panning ? 'true' : undefined}
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label="Map canvas"
      onKeyDown={onCanvasKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()} // else a mid-gesture menu leaves the press hanging
    >
      <div className="map-canvas__world" {...worldStyle(viewport)}>
        {maps.map((map) => (
          <MapImage
            key={map.id}
            map={map}
            selected={map.id === selectedMapId}
            onPointerDown={tool.kind === 'move-map' ? mapDrag.onPointerDown : null}
            onPointerMove={mapDrag.onPointerMove}
            onPointerUp={mapDrag.onPointerUp}
            onPointerCancel={mapDrag.onPointerCancel}
            crisp={viewport.scale * map.scale >= 1} // boolean so MapImage's memo only breaks at the 1:1 crossing
          />
        ))}
        {children}
        <ZoneDraft draft={zoneTool.draft} maps={maps} />
        {tool.kind === 'draw-zone' && selectedZone !== null && (
          <ZoneHandles zone={selectedZone.zone} map={selectedZone.map} />
        )}
      </div>

      {notice !== null && (
        <p className="map-canvas__rejected" role="status" data-canvas-ui>
          {notice.text}
        </p>
      )}

      <div className="map-canvas__hud" data-canvas-ui>
        {selectedMap !== null && <MapScaleControl map={selectedMap} />}
        <div className="map-canvas__zoom-group" role="group" aria-label="Canvas zoom">
          <button
            type="button"
            className="map-canvas__reset button"
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => zoomByFactor(1 / SCALE_STEP)}
          >
            −
          </button>
          <button
            type="button"
            className="map-canvas__reset map-canvas__zoom button"
            title="Zoom to 100% (0)"
            onClick={zoomToOne}
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            className="map-canvas__reset button"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => zoomByFactor(SCALE_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className="map-canvas__reset button"
            title="Fit every map (F)"
            onClick={fitToMaps}
          >
            Fit
          </button>
        </div>
      </div>
    </div>
  )
}

// Rendered here rather than in the memo'd ZoneLayer, since this changes every frame of the drag.
function ZoneDraft({
  draft,
  maps,
}: {
  draft: { mapId: MapId; rect: Rect } | null
  maps: readonly GameMap[]
}): ReactElement | null {
  const map = draft === null ? undefined : maps.find((candidate) => candidate.id === draft.mapId)
  if (draft === null || map === undefined) return null
  return (
    <div className="map-canvas__zone-group" style={mapGroupStyle(map)}>
      <div
        className="map-canvas__zone-draft"
        style={{
          left: `${draft.rect.x}px`,
          top: `${draft.rect.y}px`,
          width: `${draft.rect.width}px`,
          height: `${draft.rect.height}px`,
        }}
      />
    </div>
  )
}

// Which grip a press claims is decided geometrically in use-zone-tool.ts; a press here only
// carries the resize cursor and still bubbles to the canvas, which owns the gesture.
function ZoneHandles({ zone, map }: { zone: Zone; map: GameMap }): ReactElement {
  return (
    <div className="map-canvas__zone-group" style={mapGroupStyle(map)}>
      {zoneHandlePoints(zone.polygon).map(({ handle, point }) => (
        <div
          key={handle}
          className="map-canvas__zone-handle"
          data-handle={handle}
          style={{ left: `${point.x}px`, top: `${point.y}px` }}
        />
      ))}
    </div>
  )
}

function arrowDelta(key: string): Point {
  switch (key) {
    case 'ArrowUp':
      return { x: 0, y: -1 }
    case 'ArrowDown':
      return { x: 0, y: 1 }
    case 'ArrowLeft':
      return { x: -1, y: 0 }
    case 'ArrowRight':
      return { x: 1, y: 0 }
    default:
      return { x: 0, y: 0 }
  }
}

// Exhaustive over CanvasTool; draw-zone handles its own pointer gestures in useZoneTool.
function handleCanvasClick(
  anchor: Point,
  at: Viewport,
  {
    maps,
    zones,
    tool,
    armedCaptureId,
    onDialoguePlaced,
    showNotice,
  }: {
    maps: readonly GameMap[]
    zones: readonly Zone[]
    tool: CanvasTool
    armedCaptureId: PendingCaptureId | null
    onDialoguePlaced: (dialogueId: DialogueId) => void
    showNotice: (text: string) => void
  },
): void {
  switch (tool.kind) {
    case 'move-map':
      clearSelection()
      return

    // Pins stop propagation, so a click reaching here missed every pin.
    case 'inspect': {
      const canvasPoint = screenToWorld(at, anchor)
      const hitZone = zoneAtCanvasPoint(maps, zones, canvasPoint)
      if (hitZone !== null) {
        selectZone(hitZone.id)
      } else {
        const hitMap = mapAtCanvasPoint(maps, canvasPoint)
        if (hitMap === null) clearSelection()
        else selectMap(hitMap.id)
      }
      return
    }

    case 'place-dialogue': {
      const canvasPoint = screenToWorld(at, anchor)
      const map = mapAtCanvasPoint(maps, canvasPoint)
      // A Dialogue requires a real mapId; a miss leaves any armed capture armed for retry.
      if (map === null) {
        showNotice('No map there — place a dialogue on top of a map.')
        return
      }

      if (armedCaptureId !== null) {
        const dialogueId = newDialogueId()
        dispatch({
          kind: 'pending-capture/placed',
          captureId: armedCaptureId,
          dialogueId,
          mapId: map.id,
          position: canvasToMapLocal(map, canvasPoint),
        })
        // No selectDialogue here — the queue stays on screen and pages to the next waiting
        // capture instead of swapping to the panel for the one just placed.
        onDialoguePlaced(dialogueId)
        return
      }

      const dialogue: Dialogue = {
        id: newDialogueId(),
        mapId: map.id,
        npcName: '',
        position: canvasToMapLocal(map, canvasPoint),
        text: '',
        media: [],
        spokenAt: new Date().toISOString(),
        relevance: [],
        references: [],
      }
      dispatch({ kind: 'dialogue/added', dialogue })
      selectDialogue(dialogue.id)
      onDialoguePlaced(dialogue.id)
      return
    }

    case 'draw-zone':
      return

    // A pin click resolves the pick directly in PinLayer (it alone knows which pin was hit);
    // a miss here just means the canvas itself was clicked, so the mode stays armed.
    case 'pick-reference':
      return

    default:
      return assertNever(tool)
  }
}

function nudgeSelection(
  direction: Point,
  step: number,
  selection: Selection,
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
): void {
  const dx = direction.x * step
  const dy = direction.y * step
  if (selection.kind === 'dialogue') {
    const dialogue = dialogues.find((candidate) => candidate.id === selection.id)
    if (dialogue === undefined) return
    dispatch({
      kind: 'dialogue/moved',
      dialogueId: dialogue.id,
      position: { x: dialogue.position.x + dx, y: dialogue.position.y + dy },
    })
    return
  }
  if (selection.kind === 'zone') {
    const target = zones.find((candidate) => candidate.id === selection.id)
    if (target === undefined) return
    dispatch({
      kind: 'zone/reshaped',
      zoneId: target.id,
      polygon: translatePolygon(target.polygon, { x: dx, y: dy }),
    })
  }
}

// Keyboard resize goes through the same grips and floor as the pointer drag.
function resizeSelectedZone(
  direction: Point,
  step: number,
  selectedZone: { zone: Zone; map: GameMap } | null,
  viewport: Viewport,
): void {
  if (selectedZone === null) return
  const { zone: target, map } = selectedZone
  dispatch({
    kind: 'zone/reshaped',
    zoneId: target.id,
    polygon: resizePolygon(
      target.polygon,
      direction.x === 0 ? 's' : 'e',
      { x: direction.x * step, y: direction.y * step },
      minZoneSizeIn(viewport, map),
    ),
  })
}

function handleCanvasKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  {
    selection,
    dialogues,
    zones,
    selectedZone,
    viewport,
    zoomByFactor,
    zoomToOne,
    fitToMaps,
    panBy,
  }: {
    selection: Selection
    dialogues: readonly Dialogue[]
    zones: readonly Zone[]
    selectedZone: { zone: Zone; map: GameMap } | null
    viewport: Viewport
    zoomByFactor: (factor: number) => void
    zoomToOne: () => void
    fitToMaps: () => void
    panBy: (direction: Point, step: number) => void
  },
): void {
  if (isTextFieldFocused()) return

  switch (event.key) {
    case 'Escape':
      clearSelection()
      return

    case '+':
    case '=':
      event.preventDefault()
      zoomByFactor(SCALE_STEP)
      return

    case '-':
      event.preventDefault()
      zoomByFactor(1 / SCALE_STEP)
      return

    case '0':
      event.preventDefault()
      zoomToOne()
      return

    case 'f':
    case 'F':
      event.preventDefault()
      fitToMaps()
      return

    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': {
      event.preventDefault()
      const direction = arrowDelta(event.key)
      // Ctrl turns a nudge into a stretch of the east/south edges, so right/down grow it.
      if (event.ctrlKey && selection.kind === 'zone') {
        resizeSelectedZone(direction, event.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP, selectedZone, viewport)
      } else if (selection.kind === 'dialogue' || selection.kind === 'zone') {
        nudgeSelection(direction, event.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP, selection, dialogues, zones)
      } else {
        panBy(direction, event.shiftKey ? PAN_STEP * PAN_STEP_FAST : PAN_STEP)
      }
      return
    }

    default:
      return
  }
}

// --map-zoom lets pins counter-scale in CSS against one custom property instead of N per-element
// updates (#10); data-pin-labels rides beside it for the same reason — PinLayer takes no
// viewport-derived prop, so the label threshold reaches it via attribute, not a prop.
function worldStyle(viewport: Viewport): {
  style: CSSProperties & Record<'--map-zoom', string>
  'data-pin-labels'?: 'hidden'
} {
  return {
    style: {
      // Right-to-left so the world point at viewport.x/y lands on the screen origin; matches worldToScreen.
      transform: `scale(${viewport.scale}) translate(${-viewport.x}px, ${-viewport.y}px)`,
      '--map-zoom': String(viewport.scale),
    },
    'data-pin-labels': viewport.scale < PIN_LABEL_ZOOM_THRESHOLD ? 'hidden' : undefined,
  }
}

function MapScaleControl({ map }: { map: GameMap }): ReactElement {
  function rescale(factor: number): void {
    dispatch({ kind: 'map/scaled', mapId: map.id, scale: map.scale * factor })
  }

  return (
    <div className="map-canvas__scale" role="group" aria-label={`Scale of ${map.name}`}>
      <button
        type="button"
        className="map-canvas__reset button"
        aria-label={`Shrink ${map.name}`}
        disabled={clampMapScale(map.scale) <= MIN_MAP_SCALE}
        onClick={() => rescale(1 / SCALE_STEP)}
      >
        −
      </button>
      <span className="map-canvas__zoom">{Math.round(map.scale * 100)}%</span>
      <button
        type="button"
        className="map-canvas__reset button"
        aria-label={`Enlarge ${map.name}`}
        disabled={clampMapScale(map.scale) >= MAX_MAP_SCALE}
        onClick={() => rescale(SCALE_STEP)}
      >
        +
      </button>
    </div>
  )
}

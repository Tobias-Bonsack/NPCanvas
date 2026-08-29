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

/**
 * How long the view must be still before the visible rect is republished.
 *
 * World-space layers must stay viewport-independent — see CLAUDE.md — so this value cannot
 * be a per-frame prop without re-rendering every pin on every pointermove. Waiting for the
 * gesture to settle keeps panning free and still loads thumbnails the moment it stops.
 */
const SETTLE_MS = 150

/**
 * Fraction of the viewport the published rect is grown by, on each side. A pin's marker
 * extends well past its point, so an exact rect would leave a half-visible pin at the edge
 * showing a glyph while its neighbour a pixel inside shows a thumbnail.
 */
const CULL_MARGIN = 0.15

/** Where the viewport lands when a project has no maps to fit to. */
const EMPTY_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }

/** One press of the scale control, or one `+`/`−` keypress. A ratio, so a step feels the same
 *  at every size. */
const SCALE_STEP = 1.25

/**
 * Below this zoom, a pin's label is more likely than not to overlap its neighbour's — see #95.
 * Chosen against the two `Professor Oak2` and `Areana Heller`/`Schwimmerin` labels observed
 * overlapping at the 13% `Fit` zoom in the test project; 50% leaves enough screen distance
 * between typically-spaced pins for a 12rem label to clear its neighbour.
 */
const PIN_LABEL_ZOOM_THRESHOLD = 0.5

/** How long a rejected gesture explains itself before the canvas is quiet again. */
const NOTICE_MS = 4000

/** One arrow-key pan, in screen pixels — enough to read as a nudge rather than a jump. */
const PAN_STEP = 48
/** `Shift`+arrow. A ratio to `PAN_STEP` rather than a second constant to keep in step with it. */
const PAN_STEP_FAST = 8

/** One arrow-key nudge of the selected pin or zone, in that entity's own map-local pixels. */
const NUDGE_STEP = 1
/** `Shift`+arrow. Ten map-local pixels reads as a step at every scale a zone is drawn at. */
const NUDGE_STEP_FAST = 10

/**
 * Controls layered over the map — the HUD, a pin's delete confirmation — carry
 * `data-canvas-ui`, and a press starting inside one is that control's business, not a
 * canvas gesture.
 *
 * Without this the container captures the pointer even for a press that began on a button.
 * Capture retargets `pointerup` to the container, so the browser fires `click` on the
 * nearest common ancestor of the down and up targets — the container — and the button's
 * own `onClick` never runs. Keyboard activation is unaffected, which is why such a button
 * appears to work with Enter and be dead to the mouse.
 */
function isCanvasChrome(target: EventTarget): boolean {
  // `instanceof` rather than a cast: React types `target` as the bare `EventTarget`.
  return target instanceof Element && target.closest('[data-canvas-ui]') !== null
}

/**
 * Container-relative coordinates, which is the space every viewport transform expects.
 *
 * Takes the container's client origin rather than measuring it: this runs on every wheel
 * event and on every pointermove of a drag, and a `getBoundingClientRect()` there forces a
 * layout flush per frame. Structural in its event, so a wheel event and a React pointer event
 * both satisfy it.
 */
function anchorOf(event: { clientX: number; clientY: number }, origin: Point): Point {
  return { x: event.clientX - origin.x, y: event.clientY - origin.y }
}

/**
 * The rectangle the one-shot `focus` intent fits the viewport to — a map's own footprint, or
 * the zone's, resolved through the map it is drawn on. `null` for a target that named a map or
 * zone since deleted, which the caller treats as "nothing to jump to" rather than an error.
 */
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
  /** The viewport every in-flight gesture computes against — see the gesture hooks. */
  viewportRef: { current: Viewport }
  containerOrigin: { current: Point }
  applyViewport: (next: Viewport) => void
  fitToMaps: () => void
  zoomByFactor: (factor: number) => void
  zoomToOne: () => void
  panBy: (direction: Point, step: number) => void
}

/**
 * The viewport machinery every gesture reads and none of them owns: the container's measured
 * size, the live `Viewport`, fit-to-maps, the wheel's zoom/pan, and the settle timer that
 * republishes both the viewport and the visible rect once a gesture stops rather than every
 * frame of it — see CLAUDE.md § "World-space layers must stay viewport-independent". Kept as a
 * hook local to this file rather than a fourth exported one: nothing here is a pointer gesture
 * a session would go looking for beside the pan, the zone tool, or the map drag.
 */
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
  /**
   * The container's position in client coordinates, cached because it only changes when the
   * container is resized — and read on every wheel event, every click, and every pointermove
   * of a zone draw. Measuring there forces a style/layout flush per frame in a subtree that is
   * being restyled per frame.
   */
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
      // Position and size measured together: a resize is the only thing that moves the
      // container, so this is the one place either has to be read from the DOM.
      const bounds = element.getBoundingClientRect()
      containerOrigin.current = { x: bounds.left, y: bounds.top }
      setContainer({ width: box.width, height: box.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [containerRef])

  /**
   * The container must never hold a scroll offset. `overflow: hidden` hides overflow but the
   * box stays *scrollable*: focusing, or programmatically revealing, any descendant outside the
   * visible area makes the browser set `scrollLeft`/`scrollTop`, and nothing ever puts them
   * back. Every conversion here measures from `containerOrigin`, which comes from
   * `getBoundingClientRect()` — unaffected by an element's own scroll — so from that moment
   * every click, wheel anchor and drawn zone is off by the offset, permanently, until the
   * canvas remounts.
   *
   * The known trigger is a cold load of `#/canvas?dialogue=<id>` for an off-screen pin, which
   * `preventScroll` in `PinLayer` already covers. This is the guarantee for every other path —
   * a future focus call, an `Element.scrollIntoView`, a find-in-page hit.
   */
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

  /**
   * The same guards as the fit-on-mount effect below: fitting against a container that has
   * not been laid out divides by zero and lands on `MIN_SCALE` with an off-centre origin.
   * A project with no maps still resets — there is nothing to fit, but the button must undo
   * a pan across empty canvas.
   */
  function fitToMaps(): void {
    if (container.width === 0 || container.height === 0) return
    const bounds = mapsBounds(maps)
    applyViewport(bounds === null ? EMPTY_VIEWPORT : fitRectToContainer(bounds, container))
  }

  // Fit once, when the container has actually been measured — not on every resize, which
  // would yank the view out from under a user dragging the window edge, and not when a map
  // is imported or moved, which must leave the view where the user put it. The first
  // measurement arrives a frame after mount, when the container is still zero-sized, so the
  // size is a gate rather than a dependency. Already `true` when a viewport was restored from
  // `initialViewport`: a switch back to the canvas must land where the user left it, not re-fit.
  const fitted = useRef(initialViewport !== null)
  useEffect(() => {
    if (fitted.current) return
    if (container.width === 0 || container.height === 0) return
    const bounds = mapsBounds(maps)
    if (bounds === null) return
    fitted.current = true
    applyViewport(fitRectToContainer(bounds, container))
  }, [maps, container, applyViewport])

  // Focus is a one-shot intent, so it is consumed and cleared rather than held: leaving it
  // in the hash would re-run this on every render and fight a user who panned away. An
  // unknown id — a link to a map or zone since deleted — is still cleared, so the hash never
  // sticks.
  useEffect(() => {
    if (focus === null) return
    if (container.width === 0 || container.height === 0) return
    const rect = focusRect(focus, maps, zones)
    if (rect !== null) {
      // Suppresses the fit-on-mount above: arriving at #/canvas?focus=<target> should land on
      // it, not fit everything and then jump.
      fitted.current = true
      applyViewport(fitRectToContainer(rect, container))
    }
    onFocusApplied()
  }, [focus, maps, zones, container, onFocusApplied, applyViewport])

  // Every viewport change restarts the timer, so a pan or a zoom publishes exactly once, when
  // it stops. `setTimeout` rather than `requestIdleCallback`: the delay is the point, and idle
  // time during a gesture arrives every frame. The viewport itself piggybacks on the same
  // timer, for the same reason: `onViewportChange` writes one level up, and a per-frame write
  // there would re-render `MapScreen` on every pointermove of a pan.
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
    const element = containerRef.current
    if (element === null) return

    // An arrow const, not a function declaration: a declaration is hoisted above the null
    // check, so TypeScript refuses to narrow `element` inside it.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      // No gesture guard: a zoom or a pan during a drag or a zone draw is legitimate, and every
      // gesture reads `viewportRef` rather than a snapshot precisely so this lands and stays.
      //
      // Which gesture does which is `wheel-zoom.ts`'s doc comment: the wheel zooms, whether it
      // arrives as a mouse notch or as a trackpad pinch (`ctrlKey`), and `shiftKey` is the
      // scroll-to-pan a trackpad keeps.
      if (!event.shiftKey) {
        const anchor = anchorOf(event, containerOrigin.current)
        applyViewport(zoomAt(viewportRef.current, anchor, wheelZoomFactor(event)))
        return
      }

      const delta = normalizeDelta(event)
      const view = viewportRef.current
      // Divided by the scale because the viewport origin is in world units: a scroll should
      // move the content by the pixels the user asked for, whatever the canvas is zoomed to.
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

  /** `0`: the readout's own click target too — zoom to 100% about the centre, not a re-fit. */
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
  /** Already carrying any in-progress drag preview — see `MapScreen`. */
  maps: readonly GameMap[]
  /**
   * Not for rendering — `ZoneLayer` does that — but for hit-testing: a zone's clickable area
   * is its geometry, tested here, rather than a filled SVG polygon that would swallow every
   * pan starting inside it.
   */
  zones: readonly Zone[]
  /** For the same reason `zones` is here: nudging the selected pin needs its live position. */
  dialogues: readonly Dialogue[]
  /** What the keyboard nudges — only a dialogue or a zone has a map-local position to nudge. */
  selection: Selection
  tool: CanvasTool
  selectedMapId: MapId | null
  /** A map or a zone to jump the viewport to, once. Cleared through `onFocusApplied` immediately. */
  focus: FocusTarget | null
  onFocusApplied: () => void
  /**
   * Reports the live drag position upwards, because the pin layer is a sibling and its maps
   * must move with the image in the same frame. `null` ends the drag.
   */
  onMapDrag: (preview: MapDragPreview | null) => void
  /** The same contract as `onMapDrag`, for a zone being moved. `null` ends the drag. */
  onZoneDrag: (preview: ZoneDragPreview | null) => void
  /**
   * The canvas-space rectangle on screen, republished once the view settles rather than per
   * frame — see `SETTLE_MS`. Must be stable, because an effect depends on it.
   */
  onVisibleRectChange: (rect: Rect) => void
  /**
   * Fires once a placement lands, so `MapScreen` can move focus into the new dialogue's NPC
   * field instead of onto its pin, offer the previous line's relevance tags, and return the
   * tool to `inspect` — see #45. The pin's own focus-follow effect is suppressed for this same
   * id, which is what keeps the two paths from fighting over focus in the same commit.
   */
  onDialoguePlaced: (dialogueId: DialogueId) => void
  /**
   * A pending capture armed for placement from `PendingCaptureList`, or `null`. When set, a
   * `place-dialogue` click dispatches `pending-capture/placed` instead of building an empty
   * `Dialogue` — the same click, the same hit-test, the same map resolution; only what gets
   * dispatched differs. `MapScreen` clears it whenever the tool leaves `place-dialogue`, which is
   * what `onDialoguePlaced`'s own tool reset already does after a successful placement.
   */
  armedCaptureId: PendingCaptureId | null
  /**
   * The last viewport this canvas settled on, persisted one level up so a switch away and back
   * lands where the user left it — see CLAUDE.md's view-state note. `null` on a project's very
   * first visit, which is what the fit-on-mount effect treats as "nothing to restore".
   * Read only at mount: this component owns the live value from then on and reports back
   * through `onViewportChange`, so a value pushed from outside after mount is never round-tripped
   * back down into a fresh `useState` initializer.
   */
  initialViewport: Viewport | null
  /** Published once the view settles — see `SETTLE_MS` — never per frame of a gesture. */
  onViewportChange: (viewport: Viewport) => void
  /** Rendered inside the world element, so children position in canvas coordinates. */
  children?: ReactNode
}

/**
 * The transform surface everything else sits on: DOM under one CSS transform, not
 * `<canvas>`. See CLAUDE.md § Domain and architecture decisions.
 *
 * Every map in the project is on screen at once, each in its own group placed by `origin`
 * and sized by `scale`. The canvas transform is *canvas* space; a map's contents are
 * map-local and ride along inside its group.
 *
 * `Viewport` is component state, not store state — it is transient UI, and putting it in the
 * store would push a document-shaped update through autosave on every pointermove.
 *
 * The three gestures the canvas offers — pan, the zone tool, and dragging a map — are each
 * their own hook (`use-pan-gesture.ts`, `use-zone-tool.ts`, `use-map-drag.ts`): this component
 * arbitrates which one a press belongs to and owns what is common to all of them (the
 * viewport, the settle timer, the notice banner), but none of a gesture's own bookkeeping.
 */
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
  // Drives `will-change` on the world element for the duration of a gesture that repaints
  // the world every frame — a pan, a map drag, a zone drag — and for no longer. See the comment
  // on `.map-canvas[data-panning]`. Two renders per gesture, not one per frame.
  //
  // The map drag needs saying explicitly: it `stopPropagation()`s so the canvas underneath does
  // not also start panning, which means the container's own pointerdown never runs and the
  // promotion would otherwise be off during the one gesture that repaints the most.
  const [panning, setPanning] = useState(false)
  // A gesture that refused to commit, saying why. Nonced rather than compared by text, so the
  // same rejection twice restarts the timer instead of expiring on the first one's clock.
  const [notice, setNotice] = useState<{ nonce: number; text: string } | null>(null)
  const nextNotice = useRef(0)
  // Once per change, not once per pan frame: this component re-renders on every pointermove
  // of a pan, and the scan is over every map in the project.
  const selectedMap = useMemo(
    () => maps.find((map) => map.id === selectedMapId) ?? null,
    [maps, selectedMapId],
  )

  // The zone whose resize grips are on screen, with the map they are expressed on. Memoized
  // for the reason `selectedMap` is — this runs on every frame of a pan — and carrying the
  // map because every grip coordinate is map-local and needs it to reach the screen. The
  // zone is taken from `zones`, so a drag preview moves the grips with the shape.
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
    // The zone tool claims a press that landed on a map; one on bare canvas falls through to
    // a pan, so the canvas is still navigable without switching tools.
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
    // `pointerup` carries the button that was *released*. Without this gate, releasing the
    // right button during a held left-press would run the click path — a mouse reports one
    // pointerId for every button, so the id guard cannot tell them apart.
    if (event.button !== 0) return
    if (zoneTool.ref.current !== null) {
      zoneTool.end(event)
      return
    }
    const end = pan.end(event)
    if (end === null || end.moved) return

    // The current viewport, not the one the press started against: a wheel notch between
    // pointerdown and pointerup would otherwise place the pin at the pre-zoom world point,
    // hundreds of map pixels from the cursor at 8×.
    onCanvasClick(anchorOf(event, containerOrigin.current), viewportRef.current)
  }

  /**
   * A cancel is the platform saying the gesture did not happen — an OS takeover, a touch
   * promoted to a browser gesture, a pen leaving range. Neither gesture dispatches anything on
   * cancel: every preview is dropped and the document stays as it was.
   */
  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    pan.cancel(event)
    zoneTool.cancel(event)
  }

  /** Everything a click needs to resolve, so `handleCanvasClick` can live at module scope. */
  function onCanvasClick(anchor: Point, at: Viewport): void {
    handleCanvasClick(anchor, at, { maps, zones, tool, armedCaptureId, onDialoguePlaced, showNotice })
  }

  /**
   * Everything here is scoped by React's own bubbling: it only fires while focus is inside
   * this container, so a text field anywhere else in the app — `DialoguePanel`'s line, a
   * sidebar rename input — is never a descendant and never sees it. `isTextFieldFocused` is
   * kept as a second guard anyway, for a text field a future canvas overlay adds inside this
   * subtree, and because every new shortcut this issue adds must honour it uniformly. The body
   * lives at module scope (`handleCanvasKeyDown`) for the same reason `handleCanvasClick` does.
   */
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
      // Focusable and keyboard-operable in its own right — Tab reaches it (and past it, to a
      // pin), Escape/arrows/zoom/fit all bubble here from whatever inside it has focus.
      tabIndex={0}
      role="group"
      aria-label="Map canvas"
      onKeyDown={onCanvasKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      // The canvas has no context menu of its own, and one opening mid-gesture leaves the
      // press hanging: the menu takes the pointer and no pointerup ever reaches the canvas.
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="map-canvas__world" {...worldStyle(viewport)}>
        {maps.map((map) => (
          <MapImage
            key={map.id}
            map={map}
            selected={map.id === selectedMapId}
            // Attached only under move-map, so pressing a map is inert under every other
            // tool and the press falls through to the canvas as a pan.
            onPointerDown={tool.kind === 'move-map' ? mapDrag.onPointerDown : null}
            onPointerMove={mapDrag.onPointerMove}
            onPointerUp={mapDrag.onPointerUp}
            onPointerCancel={mapDrag.onPointerCancel}
            // Screen pixels per map pixel. A boolean rather than the number, so `MapImage`'s
            // memo breaks on the 1:1 crossing rather than on every frame of a zoom.
            crisp={viewport.scale * map.scale >= 1}
          />
        ))}
        {children}
        <ZoneDraft draft={zoneTool.draft} maps={maps} />
        {/* Only under the zone tool, and only for the selected zone: grips that were always
            on screen would advertise a gesture every other tool refuses. */}
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
            className="map-canvas__reset"
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => zoomByFactor(1 / SCALE_STEP)}
          >
            −
          </button>
          <button
            type="button"
            className="map-canvas__reset map-canvas__zoom"
            title="Zoom to 100% (0)"
            onClick={zoomToOne}
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            className="map-canvas__reset"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => zoomByFactor(SCALE_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className="map-canvas__reset"
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

/**
 * The rectangle being dragged out, inside its map's own group so it is expressed in the same
 * map-local pixels that will be committed — what is on screen is exactly what is stored.
 * Rendered here rather than in `ZoneLayer` because it changes every frame, and that layer is
 * memo'd precisely so nothing per-frame reaches it.
 */
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

/**
 * The eight grips of the selected zone's bounding box, drawn inside that zone's map group so
 * each one is positioned by a map-local coordinate verbatim — the same contract `ZoneDraft`
 * follows, and the reason neither lives in the memo'd `ZoneLayer`.
 *
 * They take the pointer only to carry a resize cursor: which grip a press actually claims is
 * decided geometrically in `handleAtCanvasPoint` (see `use-zone-tool.ts`), the way every other
 * canvas hit test is. A press here still bubbles to the canvas, which owns the gesture.
 */
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

/** A unit vector for the arrow key pressed, or the zero vector for anything else. */
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

/** Exhaustive over `CanvasTool`. `draw-zone` handles its own pointer gestures in `useZoneTool`. */
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
      // A click on bare canvas is how a selection is dismissed.
      clearSelection()
      return

    // Pins stop propagation, so a click reaching here missed every pin: what is left under
    // the cursor is a zone, the map underneath it, or bare canvas. A map hit is what makes
    // `MapScaleControl` reachable without switching to `move-map`.
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
      // A Dialogue requires a real mapId, so a click on bare canvas places nothing rather
      // than inventing an association — said here rather than left silent, since the draft
      // rectangle case a few lines up already sets the precedent for a rejected gesture. A
      // capture armed for placement is not lost on a miss either: it stays armed for the
      // next click, exactly like this notice already lets a blank placement be retried.
      if (map === null) {
        showNotice('No map there — place a dialogue on top of a map.')
        return
      }

      // Arming a capture from `PendingCaptureList` turns this same click into a placement
      // instead of a blank dialogue — no second tool, no second hit-test. Everything above
      // this line already resolved the map and the point either way.
      if (armedCaptureId !== null) {
        const dialogueId = newDialogueId()
        dispatch({
          kind: 'pending-capture/placed',
          captureId: armedCaptureId,
          dialogueId,
          mapId: map.id,
          position: canvasToMapLocal(map, canvasPoint),
        })
        selectDialogue(dialogueId)
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
      }
      dispatch({ kind: 'dialogue/added', dialogue })
      selectDialogue(dialogue.id)
      onDialoguePlaced(dialogue.id)
      return
    }

    case 'draw-zone':
      return

    default:
      return assertNever(tool)
  }
}

/** Only a dialogue or a zone has a map-local position — a selected map is not nudged. */
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

/**
 * The keyboard's half of resizing: one axis per press, through the same grips and the same
 * floor the pointer drags through, so a stretch nobody can do with a mouse cannot be done
 * with the arrows either.
 */
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

/** The body of `onCanvasKeyDown`, at module scope for the same reason `handleCanvasClick` is. */
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
      // Ctrl is what turns a nudge into a stretch, and only a zone has a size to stretch.
      // The east and south edges are the ones that move, so the shape follows the arrow:
      // right and down grow it, left and up shrink it.
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

/**
 * `--map-zoom` is written here, once per frame, so that pins can counter-scale in CSS
 * against a single custom property instead of N per-element style updates. See #10.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 *
 * `data-pin-labels` rides beside it for the same reason: `PinLayer`'s three `memo` boundaries
 * take no prop derived from the viewport (see CLAUDE.md § "World-space layers must stay
 * viewport-independent"), so the threshold has to reach the pins some other way than a prop —
 * a sibling attribute a descendant selector reads costs one attribute write on a threshold
 * crossing and nothing per pin, same as `--map-zoom` itself. This is the *only* place either is
 * decided; a layer that wants to know about zoom reads this attribute, it does not add a prop.
 */
function worldStyle(viewport: Viewport): {
  style: CSSProperties & Record<'--map-zoom', string>
  'data-pin-labels'?: 'hidden'
} {
  return {
    style: {
      // Right-to-left, so the world point at `viewport.x/y` lands on the screen origin and
      // everything else scales around it. Matches `worldToScreen` exactly.
      transform: `scale(${viewport.scale}) translate(${-viewport.x}px, ${-viewport.y}px)`,
      '--map-zoom': String(viewport.scale),
    },
    'data-pin-labels': viewport.scale < PIN_LABEL_ZOOM_THRESHOLD ? 'hidden' : undefined,
  }
}

/**
 * Ratio steps rather than a slider: each press is one `map/scaled` dispatch, so the document
 * changes once per interaction. `map/scaled` moves the origin to keep the map's centre fixed,
 * which is what makes a nudge read as adjustment rather than as the map drifting away.
 */
function MapScaleControl({ map }: { map: GameMap }): ReactElement {
  function rescale(factor: number): void {
    dispatch({ kind: 'map/scaled', mapId: map.id, scale: map.scale * factor })
  }

  return (
    <div className="map-canvas__scale" role="group" aria-label={`Scale of ${map.name}`}>
      <button
        type="button"
        className="map-canvas__reset"
        aria-label={`Shrink ${map.name}`}
        disabled={clampMapScale(map.scale) <= MIN_MAP_SCALE}
        onClick={() => rescale(1 / SCALE_STEP)}
      >
        −
      </button>
      <span className="map-canvas__zoom">{Math.round(map.scale * 100)}%</span>
      <button
        type="button"
        className="map-canvas__reset"
        aria-label={`Enlarge ${map.name}`}
        disabled={clampMapScale(map.scale) >= MAX_MAP_SCALE}
        onClick={() => rescale(SCALE_STEP)}
      >
        +
      </button>
    </div>
  )
}

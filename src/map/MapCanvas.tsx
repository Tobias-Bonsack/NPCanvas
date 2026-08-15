import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react'
import { useEffect, useRef, useState } from 'react'
import { assertNever } from '../assert-never.ts'
import type { MediaUrl } from '../media/media-url-cache.ts'
import { useMediaUrl } from '../media/media-url-cache.ts'
import { newDialogueId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type { CanvasTool, Dialogue, GameMap, MapId, Point } from '../project/types.ts'
import { navigate } from '../app/route.ts'
import {
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
  canvasToMapLocal,
  clampMapScale,
  mapAtCanvasPoint,
  mapCanvasRect,
  mapsBounds,
} from './canvas-layout.ts'
import type { Rect, Size } from './geometry.ts'
import { mapGroupStyle } from './map-group-style.ts'
import type { Viewport } from './viewport.ts'
import { fitRectToContainer, screenToWorld, visibleWorldRect, zoomAt } from './viewport.ts'
import './MapCanvas.css'

/** Screen pixels of travel before a press stops being a click and becomes a pan. */
const CLICK_THRESHOLD = 4

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

/** One press of the scale control. A ratio, so a step feels the same at every size. */
const SCALE_STEP = 1.25

/**
 * A map being dragged, in canvas coordinates. It is a *preview*: `map/moved` is dispatched
 * once, on pointerup, so autosave sees one document change per drag rather than one per
 * frame — the same contract pin dragging follows.
 */
export type MapDragPreview = { id: MapId; origin: Point }

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
 * The transform surface everything else sits on: DOM under one CSS transform, not
 * `<canvas>`. See CLAUDE.md § Domain and architecture decisions.
 *
 * Every map in the project is on screen at once, each in its own group placed by `origin`
 * and sized by `scale`. The canvas transform is *canvas* space; a map's contents are
 * map-local and ride along inside its group.
 *
 * `Viewport` is component state, not store state — it is transient UI, and putting it in the
 * store would push a document-shaped update through autosave on every pointermove.
 */
export function MapCanvas({
  maps,
  tool,
  selectedMapId,
  focusMapId,
  onFocusApplied,
  onMapDrag,
  onVisibleRectChange,
  children,
}: {
  /** Already carrying any in-progress drag preview — see `MapScreen`. */
  maps: readonly GameMap[]
  tool: CanvasTool
  selectedMapId: MapId | null
  /** A map to jump the viewport to, once. Cleared through `onFocusApplied` immediately. */
  focusMapId: MapId | null
  onFocusApplied: () => void
  /**
   * Reports the live drag position upwards, because the pin layer is a sibling and its maps
   * must move with the image in the same frame. `null` ends the drag.
   */
  onMapDrag: (preview: MapDragPreview | null) => void
  /**
   * The canvas-space rectangle on screen, republished once the view settles rather than per
   * frame — see `SETTLE_MS`. Must be stable, because an effect depends on it.
   */
  onVisibleRectChange: (rect: Rect) => void
  /** Rendered inside the world element, so children position in canvas coordinates. */
  children?: ReactNode
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Viewport>(EMPTY_VIEWPORT)
  const selectedMap = maps.find((map) => map.id === selectedMapId) ?? null

  useEffect(() => {
    const element = containerRef.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setContainer({ width: box.width, height: box.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function fitToMaps(): void {
    const bounds = mapsBounds(maps)
    setViewport(bounds === null ? EMPTY_VIEWPORT : fitRectToContainer(bounds, container))
  }

  // Fit once, when the container has actually been measured — not on every resize, which
  // would yank the view out from under a user dragging the window edge, and not when a map
  // is imported or moved, which must leave the view where the user put it. The first
  // measurement arrives a frame after mount, when the container is still zero-sized, so the
  // size is a gate rather than a dependency.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return
    if (container.width === 0 || container.height === 0) return
    const bounds = mapsBounds(maps)
    if (bounds === null) return
    fitted.current = true
    setViewport(fitRectToContainer(bounds, container))
  }, [maps, container])

  // Focus is a one-shot intent, so it is consumed and cleared rather than held: leaving it
  // in the hash would re-run this on every render and fight a user who panned away. An
  // unknown id — a link to a map since deleted — is still cleared, so the hash never sticks.
  useEffect(() => {
    if (focusMapId === null) return
    if (container.width === 0 || container.height === 0) return
    const target = maps.find((map) => map.id === focusMapId)
    if (target !== undefined) {
      // Suppresses the fit-on-mount below: arriving at #/canvas?focus=<id> should land on
      // that map, not fit everything and then jump.
      fitted.current = true
      setViewport(fitRectToContainer(mapCanvasRect(target), container))
    }
    onFocusApplied()
  }, [focusMapId, maps, container, onFocusApplied])

  // Every viewport change restarts the timer, so a pan or a zoom publishes exactly once, when
  // it stops. `setTimeout` rather than `requestIdleCallback`: the delay is the point, and idle
  // time during a gesture arrives every frame.
  useEffect(() => {
    if (container.width === 0 || container.height === 0) return
    const timer = setTimeout(() => {
      onVisibleRectChange(inflate(visibleWorldRect(viewport, container), CULL_MARGIN))
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [viewport, container, onVisibleRectChange])

  // Bound by hand with { passive: false }: React's onWheel is passive, so preventDefault()
  // there silently does nothing and the page scrolls instead of the map zooming.
  useEffect(() => {
    const element = containerRef.current
    if (element === null) return

    // An arrow const, not a function declaration: a declaration is hoisted above the null
    // check, so TypeScript refuses to narrow `element` inside it.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      const anchor: Point = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }
      setViewport((current) => zoomAt(current, anchor, wheelZoomFactor(event)))
    }

    element.addEventListener('wheel', onWheel, { passive: false })

    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // The viewport at pointerdown is captured here rather than read from state during the
  // drag, so the delta is always measured against the same origin and no stale closure can
  // make the map jitter.
  const pan = useRef<{
    pointerId: number
    origin: Point
    from: Viewport
    moved: boolean
  } | null>(null)

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    if (isCanvasChrome(event.target)) return
    // Capture keeps pointermove flowing after the cursor leaves the element, so a fast drag
    // does not strand the map mid-pan.
    event.currentTarget.setPointerCapture(event.pointerId)
    pan.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      from: viewport,
      moved: false,
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = pan.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.origin.x
    const dy = event.clientY - drag.origin.y
    // Below the threshold the press is still a candidate click, and panning by a pixel of
    // hand-shake would otherwise swallow it.
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_THRESHOLD) return
    drag.moved = true
    setViewport({
      ...drag.from,
      x: drag.from.x - dx / drag.from.scale,
      y: drag.from.y - dy / drag.from.scale,
    })
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = pan.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    pan.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.moved) return

    const bounds = event.currentTarget.getBoundingClientRect()
    onCanvasClick({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, drag.from)
  }

  // The map drag mirrors the pan above: the bookkeeping lives in a ref so a sub-threshold
  // wobble costs no render, and the viewport scale is captured at pointerdown so zooming
  // mid-gesture cannot shift the delta. Only the *viewport* scale converts screen pixels to
  // canvas units — the map's own scale sizes its contents, not its position, so folding it
  // in would make the map lag or outrun the cursor.
  const mapDrag = useRef<{
    pointerId: number
    id: MapId
    origin: Point
    from: Point
    viewportScale: number
    latest: Point | null
    moved: boolean
  } | null>(null)

  function onMapPointerDown(event: ReactPointerEvent<HTMLDivElement>, map: GameMap): void {
    if (event.button !== 0 || tool.kind !== 'move-map') return
    // Without this the canvas underneath would start panning at the same time.
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dispatch({ kind: 'selection/set', selection: { kind: 'map', id: map.id } })
    mapDrag.current = {
      pointerId: event.pointerId,
      id: map.id,
      origin: { x: event.clientX, y: event.clientY },
      from: map.origin,
      viewportScale: viewport.scale,
      latest: null,
      moved: false,
    }
  }

  function onMapPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = mapDrag.current
    if (drag === null || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.origin.x
    const dy = event.clientY - drag.origin.y
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_THRESHOLD) return
    drag.moved = true

    const origin: Point = {
      x: drag.from.x + dx / drag.viewportScale,
      y: drag.from.y + dy / drag.viewportScale,
    }
    drag.latest = origin
    onMapDrag({ id: drag.id, origin })
  }

  function onMapPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = mapDrag.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    mapDrag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const final = drag.latest
    onMapDrag(null)
    if (drag.moved && final !== null) {
      dispatch({ kind: 'map/moved', mapId: drag.id, origin: final })
    }
  }

  /** Exhaustive over `CanvasTool`. `draw-zone` is claimed by M5 and deliberately inert. */
  function onCanvasClick(anchor: Point, at: Viewport): void {
    switch (tool.kind) {
      case 'move-map':
      case 'inspect':
        // A click on bare canvas is how a selection is dismissed.
        dispatch({ kind: 'selection/set', selection: { kind: 'none' } })
        navigate({ kind: 'canvas', dialogueId: null, focusMapId: null })
        return

      case 'place-dialogue': {
        const canvasPoint = screenToWorld(at, anchor)
        const map = mapAtCanvasPoint(maps, canvasPoint)
        // A Dialogue requires a real mapId, so a click on bare canvas places nothing rather
        // than inventing an association.
        if (map === null) return

        const dialogue: Dialogue = {
          id: newDialogueId(),
          mapId: map.id,
          npcName: '',
          position: canvasToMapLocal(map, canvasPoint),
          content: { kind: 'text', text: '' },
          spokenAt: new Date().toISOString(),
          relevance: [],
        }
        dispatch({ kind: 'dialogue/added', dialogue })
        dispatch({ kind: 'selection/set', selection: { kind: 'dialogue', id: dialogue.id } })
        navigate({ kind: 'canvas', dialogueId: dialogue.id, focusMapId: null })
        return
      }

      case 'draw-zone':
        return

      default:
        assertNever(tool)
    }
  }

  return (
    <div
      className="map-canvas"
      data-tool={tool.kind}
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="map-canvas__world" style={worldStyle(viewport)}>
        {maps.map((map) => (
          <MapImage
            key={map.id}
            map={map}
            selected={map.id === selectedMapId}
            // Attached only under move-map, so pressing a map is inert under every other
            // tool and the press falls through to the canvas as a pan.
            onPointerDown={tool.kind === 'move-map' ? onMapPointerDown : null}
            onPointerMove={onMapPointerMove}
            onPointerUp={onMapPointerUp}
          />
        ))}
        {children}
      </div>

      <div className="map-canvas__hud" data-canvas-ui>
        {selectedMap !== null && <MapScaleControl map={selectedMap} />}
        <span className="map-canvas__zoom" aria-label="Zoom level">
          {Math.round(viewport.scale * 100)}%
        </span>
        <button type="button" className="map-canvas__reset" onClick={fitToMaps}>
          Reset view
        </button>
      </div>
    </div>
  )
}

/** Grows a rectangle by `margin` of its own size on every side. */
function inflate(rect: Rect, margin: number): Rect {
  const dx = rect.width * margin
  const dy = rect.height * margin
  return {
    x: rect.x - dx,
    y: rect.y - dy,
    width: rect.width + dx * 2,
    height: rect.height + dy * 2,
  }
}

/**
 * `--map-zoom` is written here, once per frame, so that pins can counter-scale in CSS
 * against a single custom property instead of N per-element style updates. See #10.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 */
function worldStyle(viewport: Viewport): CSSProperties & Record<'--map-zoom', string> {
  return {
    // Right-to-left, so the world point at `viewport.x/y` lands on the screen origin and
    // everything else scales around it. Matches `worldToScreen` exactly.
    transform: `scale(${viewport.scale}) translate(${-viewport.x}px, ${-viewport.y}px)`,
    '--map-zoom': String(viewport.scale),
  }
}

/**
 * The map image, or a footprint-sized placeholder while it loads or if it has gone missing.
 * A placeholder rather than an overlay notice: with every map on screen at once, the message
 * has to say *which* map it is about, and occupying the map's own rectangle says it best.
 */
function MapImage({
  map,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  map: GameMap
  selected: boolean
  /** `null` under every tool but `move-map`, which is what makes maps immovable there. */
  onPointerDown: ((event: ReactPointerEvent<HTMLDivElement>, map: GameMap) => void) | null
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
}): ReactElement {
  const media = useMediaUrl(map.file)

  return (
    <div
      className="map-canvas__map"
      data-selected={selected ? 'true' : undefined}
      data-draggable={onPointerDown === null ? undefined : 'true'}
      style={mapGroupStyle(map)}
      onPointerDown={onPointerDown === null ? undefined : (event) => onPointerDown(event, map)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {media.kind === 'ready' ? (
        <img
          className="map-canvas__image"
          src={media.url}
          alt={map.name}
          width={map.width}
          height={map.height}
          draggable={false}
        />
      ) : (
        <div
          className="map-canvas__placeholder"
          style={{ width: `${map.width}px`, height: `${map.height}px` }}
        >
          {/* Counter-scaled in CSS, so the message stays legible however small the map is. */}
          <p className="map-canvas__notice" role={media.kind === 'loading' ? undefined : 'alert'}>
            <MediaNotice map={map} media={media} />
          </p>
        </div>
      )}
    </div>
  )
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

/** Exhaustive over the non-ready `MediaUrl` variants; `ready` renders the image instead. */
function MediaNotice({ map, media }: { map: GameMap; media: MediaUrl }): ReactElement | null {
  switch (media.kind) {
    case 'ready':
      return null

    case 'loading':
      return <>Loading {map.name}…</>

    case 'missing':
      return <>{map.file.fileName} is no longer in the project’s media folder.</>

    case 'failed':
      return (
        <>
          {map.name} could not be read: {media.message}
        </>
      )

    default:
      return assertNever(media)
  }
}

/**
 * Exponential, so a notch zooms by the same *ratio* at every scale — linear steps crawl
 * when zoomed out and jump when zoomed in.
 */
function wheelZoomFactor(event: WheelEvent): number {
  // ctrlKey is a trackpad pinch, which Chromium reports as a wheel event with much smaller
  // deltas than a mouse notch; without its own coefficient a pinch barely moves the scale.
  const perUnit = event.ctrlKey ? 0.01 : 0.0015
  return Math.exp(-normalizeDelta(event) * perUnit)
}

/** deltaMode 1 is lines and 2 is pages; both need converting before the delta means pixels. */
function normalizeDelta(event: WheelEvent): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY * 16
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * 400
    default:
      return event.deltaY
  }
}

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useRef } from 'react'
import { selectMap } from '../app/select.ts'
import { dispatch } from '../project/store.ts'
import type { CanvasTool, GameMap, MapId, Point } from '../project/types.ts'
import type { DragGesture, DragGestureRef } from './drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from './drag-gesture.ts'
import type { Viewport } from './viewport.ts'
import { screenToWorld } from './viewport.ts'

/**
 * A map being dragged, in canvas coordinates. It is a *preview*: `map/moved` is dispatched
 * once, on pointerup, so autosave sees one document change per drag rather than one per
 * frame — the same contract zone dragging follows.
 */
export type MapDragPreview = { id: MapId; origin: Point }

/** What a map drag snapshots. Same contract as `ZoneGesture`: a preview plus its commit value. */
type MapDragGesture = {
  id: MapId
  from: Point
  /**
   * The canvas point under the pointer at pointerdown. The origin follows its live delta, so
   * only the *viewport* scale is ever involved — the map's own scale sizes its contents, not
   * its position, and folding it in would make the map lag the cursor.
   */
  grabbed: Point
  latest: Point | null
}

/**
 * Container-relative coordinates, which is the space every viewport transform expects.
 * Mirrors `anchorOf` in `MapCanvas.tsx`: this hook's handlers are called directly by
 * `MapImage` with the raw pointer event rather than a precomputed anchor, so it needs its own
 * copy rather than one threaded through every call.
 */
function anchorOf(event: { clientX: number; clientY: number }, origin: Point): Point {
  return { x: event.clientX - origin.x, y: event.clientY - origin.y }
}

type UseMapDragArgs = {
  tool: CanvasTool
  viewportRef: { current: Viewport }
  containerOrigin: { current: Point }
  setPanning: (panning: boolean) => void
  onMapDrag: (preview: MapDragPreview | null) => void
}

export type MapDragApi = {
  ref: DragGestureRef<MapDragGesture>
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, map: GameMap) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
}

/**
 * The map drag mirrors the pan: the bookkeeping lives in a ref so a sub-threshold wobble
 * costs no render, and the canvas point grabbed at pointerdown is what the origin trails — so
 * zooming mid-gesture moves the map with the cursor rather than jumping it.
 *
 * The four handlers are `useCallback`s because `MapImage` is memoized and they are its props:
 * a fresh identity per render would re-run `useMediaUrl` and rebuild `mapGroupStyle` for every
 * map on every frame of a pan, which is exactly what the memo is there to prevent.
 */
export function useMapDrag({
  tool,
  viewportRef,
  containerOrigin,
  setPanning,
  onMapDrag,
}: UseMapDragArgs): MapDragApi {
  const mapDrag = useRef<DragGesture<MapDragGesture> | null>(null)

  const onPointerDown = useCallback(
    function onMapPointerDown(event: ReactPointerEvent<HTMLDivElement>, map: GameMap): void {
      if (event.button !== 0 || tool.kind !== 'move-map') return
      // Without this the canvas underneath would start panning at the same time.
      event.stopPropagation()
      const began = beginDrag(mapDrag, event, {
        id: map.id,
        from: map.origin,
        // Container-relative even though the press landed on the map: `anchorOf` measures
        // from the cached container origin, so it does not care which element took the event.
        grabbed: screenToWorld(viewportRef.current, anchorOf(event, containerOrigin.current)),
        latest: null,
      })
      if (!began) return
      selectMap(map.id)
    },
    [tool, viewportRef, containerOrigin],
  )

  const onPointerMove = useCallback(
    function onMapPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
      const move = moveDrag(mapDrag, event)
      if (move === null) return
      // Guarded on the transition, as the pan is: a press that only selects a map must not
      // promote a layer, and setting it every move would re-render on every frame.
      if (move.started) setPanning(true)

      const at = screenToWorld(viewportRef.current, anchorOf(event, containerOrigin.current))
      const origin: Point = {
        x: move.data.from.x + at.x - move.data.grabbed.x,
        y: move.data.from.y + at.y - move.data.grabbed.y,
      }
      move.data.latest = origin
      onMapDrag({ id: move.data.id, origin })
    },
    [viewportRef, containerOrigin, setPanning, onMapDrag],
  )

  const onPointerUp = useCallback(
    function onMapPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
      if (event.button !== 0) return
      const end = commitDrag(mapDrag, event)
      if (end === null) return
      event.stopPropagation()

      const final = end.data.latest
      onMapDrag(null)
      setPanning(false)
      if (end.moved && final !== null) {
        dispatch({ kind: 'map/moved', mapId: end.data.id, origin: final })
      }
    },
    [onMapDrag, setPanning],
  )

  /** Drops the preview and dispatches nothing — see `MapCanvas`'s `onPointerCancel`. */
  const onPointerCancel = useCallback(
    function onMapPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
      if (cancelDrag(mapDrag, event)) {
        onMapDrag(null)
        setPanning(false)
      }
    },
    [onMapDrag, setPanning],
  )

  return { ref: mapDrag, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

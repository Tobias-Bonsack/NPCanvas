import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useRef } from 'react'
import { selectMap } from '../app/select.ts'
import { dispatch } from '../project/store.ts'
import type { CanvasTool, GameMap, MapId, Point } from '../project/types.ts'
import type { DragGesture, DragGestureRef } from './drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from './drag-gesture.ts'
import type { Viewport } from './viewport.ts'
import { screenToWorld } from './viewport.ts'

// A preview: map/moved dispatches once, on pointerup, so autosave sees one change per drag.
export type MapDragPreview = { id: MapId; origin: Point }

type MapDragGesture = {
  id: MapId
  from: Point
  // Canvas point under the pointer at pointerdown; only the viewport scale is ever involved,
  // not the map's own — the map's scale sizes its contents, not its position.
  grabbed: Point
  latest: Point | null
}

// Mirrors anchorOf in MapCanvas.tsx — needs its own copy since MapImage calls these handlers
// directly with the raw pointer event, not a precomputed anchor.
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

// Handlers are useCallbacks because MapImage is memoized and they are its props — a fresh
// identity per render would rebuild every map's memo every frame of a pan.
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
      event.stopPropagation() // else the canvas underneath starts panning too
      const began = beginDrag(mapDrag, event, {
        id: map.id,
        from: map.origin,
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

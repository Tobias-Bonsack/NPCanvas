import { useRef, useState } from 'react'
import { selectZone } from '../app/select.ts'
import { newZoneId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap, MapId, Point, Polygon, Zone, ZoneId } from '../project/types.ts'
import { mapAtCanvasPoint, zoneAtCanvasPoint, canvasToMapLocal } from './canvas-layout.ts'
import type { DragGesture, DragGestureRef, DragPointerEvent } from './drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from './drag-gesture.ts'
import type { Rect } from './geometry.ts'
import { rectBetween, rectToPolygon, translatePolygon } from './geometry.ts'
import type { Viewport } from './viewport.ts'
import { screenToWorld } from './viewport.ts'
import { nextZoneName } from './zone-name.ts'
import type { ZoneHandle } from './zone-resize.ts'
import { handleAtMapLocalPoint, resizePolygon } from './zone-resize.ts'
import { nextZoneHue } from './zone-style.ts'

// A preview: zone/reshaped lands once, on pointerup, so autosave sees one change per drag.
export type ZoneDragPreview = { id: ZoneId; polygon: Polygon }

// `latest` mirrors what's on screen so commit doesn't depend on a state closure. Neither variant
// carries a viewport — both convert the current pointer position through the live one, so a zoom
// mid-gesture moves the draft with the cursor.
type ZoneGesture =
  | { kind: 'draw'; map: GameMap; from: Point; latest: Rect | null }
  | {
      kind: 'move'
      target: Zone
      map: GameMap
      grabbed: Point
      latest: Polygon | null
    }
  | {
      kind: 'resize'
      target: Zone
      map: GameMap
      handle: ZoneHandle
      grabbed: Point
      latest: Polygon | null
    }

// Screen pixels, not map-local — map-local is not a size anyone can judge across zoom levels.
export const MIN_ZONE_SIZE = 8

// Screen pixels, for the same reason as MIN_ZONE_SIZE; a shade larger than the drawn grip.
const ZONE_HANDLE_HIT_RADIUS = 9

function screenScaleOf(viewport: Viewport, map: GameMap): number {
  return viewport.scale * map.scale
}

export function minZoneSizeIn(viewport: Viewport, map: GameMap): number {
  return MIN_ZONE_SIZE / screenScaleOf(viewport, map)
}

export function meetsMinZoneSize(rect: Rect, viewport: Viewport, map: GameMap): boolean {
  const screenScale = screenScaleOf(viewport, map)
  return rect.width * screenScale >= MIN_ZONE_SIZE && rect.height * screenScale >= MIN_ZONE_SIZE
}

// Only the selected zone has grips. Pure and exported so it is testable without mounting MapCanvas.
export function handleAtCanvasPoint(
  canvasPoint: Point,
  selectedZone: { zone: Zone; map: GameMap } | null,
  viewport: Viewport,
): { zone: Zone; map: GameMap; handle: ZoneHandle } | null {
  if (selectedZone === null) return null
  const { zone: target, map } = selectedZone
  const handle = handleAtMapLocalPoint(
    target.polygon,
    canvasToMapLocal(map, canvasPoint),
    ZONE_HANDLE_HIT_RADIUS / screenScaleOf(viewport, map),
  )
  return handle === null ? null : { zone: target, map, handle }
}

type UseZoneToolArgs = {
  maps: readonly GameMap[]
  zones: readonly Zone[]
  selectedZone: { zone: Zone; map: GameMap } | null
  viewportRef: { current: Viewport }
  setPanning: (panning: boolean) => void
  onZoneDrag: (preview: ZoneDragPreview | null) => void
  showNotice: (text: string) => void
}

export type ZoneToolApi = {
  ref: DragGestureRef<ZoneGesture>
  draft: { mapId: MapId; rect: Rect } | null
  // True when the zone tool took the press; false leaves it to the pan.
  begin: (event: DragPointerEvent, anchor: Point) => boolean
  move: (event: DragPointerEvent, anchor: Point) => void
  end: (event: DragPointerEvent) => void
  cancel: (event: DragPointerEvent) => boolean
}

// Two gestures wearing one tool: drawing a new zone, or moving/resizing an existing one via grips.
export function useZoneTool({
  maps,
  zones,
  selectedZone,
  viewportRef,
  setPanning,
  onZoneDrag,
  showNotice,
}: UseZoneToolArgs): ZoneToolApi {
  const zone = useRef<DragGesture<ZoneGesture> | null>(null)
  const [draft, setDraft] = useState<{ mapId: MapId; rect: Rect } | null>(null)

  function begin(event: DragPointerEvent, anchor: Point): boolean {
    const canvasPoint = screenToWorld(viewportRef.current, anchor)

    // Tested before the map: a grip dragged past the map's border is still a grip.
    const grip = handleAtCanvasPoint(canvasPoint, selectedZone, viewportRef.current)
    if (grip !== null) {
      return beginDrag(zone, event, {
        kind: 'resize',
        target: grip.zone,
        map: grip.map,
        handle: grip.handle,
        grabbed: canvasToMapLocal(grip.map, canvasPoint),
        latest: null,
      })
    }

    const map = mapAtCanvasPoint(maps, canvasPoint)
    if (map === null) return false

    const target = zoneAtCanvasPoint(maps, zones, canvasPoint)
    const local = canvasToMapLocal(map, canvasPoint)
    if (target !== null) {
      return beginDrag(zone, event, { kind: 'move', target, map, grabbed: local, latest: null })
    }

    return beginDrag(zone, event, { kind: 'draw', map, from: local, latest: null })
  }

  function move(event: DragPointerEvent, anchor: Point): void {
    const moved = moveDrag(zone, event)
    if (moved === null) return
    if (moved.started) setPanning(true)
    const gesture = moved.data
    // Through the live viewport, not a pointerdown snapshot — a wheel notch mid-gesture must
    // not jump the delta.
    const local = canvasToMapLocal(gesture.map, screenToWorld(viewportRef.current, anchor))

    if (gesture.kind === 'draw') {
      const rect = rectBetween(gesture.from, local)
      gesture.latest = rect
      setDraft({ mapId: gesture.map.id, rect })
      return
    }

    const travel: Point = { x: local.x - gesture.grabbed.x, y: local.y - gesture.grabbed.y }
    // Reshapes from the pointerdown polygon, never the previous frame's — accumulating would
    // compound resizePolygon's floor clamp.
    const polygon =
      gesture.kind === 'move'
        ? translatePolygon(gesture.target.polygon, travel)
        : resizePolygon(
            gesture.target.polygon,
            gesture.handle,
            travel,
            minZoneSizeIn(viewportRef.current, gesture.map),
          )
    gesture.latest = polygon
    onZoneDrag({ id: gesture.target.id, polygon })
  }

  function end(event: DragPointerEvent): void {
    const result = commitDrag(zone, event)
    if (result === null) return
    setPanning(false)
    const gesture = result.data

    if (gesture.kind !== 'draw') {
      const final = gesture.latest
      onZoneDrag(null)
      if (!result.moved || final === null) {
        selectZone(gesture.target.id) // a press that never moved just selects the zone
        return
      }
      dispatch({ kind: 'zone/reshaped', zoneId: gesture.target.id, polygon: final })
      return
    }

    const rect = gesture.latest
    setDraft(null)
    if (rect === null) return

    if (!meetsMinZoneSize(rect, viewportRef.current, gesture.map)) {
      showNotice(`Too small to be a zone — drag out at least ${MIN_ZONE_SIZE} pixels each way.`)
      return
    }

    const created: Zone = {
      id: newZoneId(),
      mapId: gesture.map.id,
      name: nextZoneName(zones, gesture.map.id),
      polygon: rectToPolygon(rect),
      hue: nextZoneHue(zones, gesture.map.id),
    }
    dispatch({ kind: 'zone/added', zone: created })
    selectZone(created.id)
  }

  function cancel(event: DragPointerEvent): boolean {
    const cancelled = cancelDrag(zone, event)
    if (cancelled) {
      setDraft(null)
      onZoneDrag(null)
      setPanning(false)
    }
    return cancelled
  }

  return { ref: zone, draft, begin, move, end, cancel }
}

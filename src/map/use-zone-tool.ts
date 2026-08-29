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

/**
 * A zone being dragged, in that zone's own map-local space. A preview: `zone/reshaped` lands
 * once, on pointerup, so autosave sees one document change per drag rather than one per frame —
 * the same contract map dragging follows.
 */
export type ZoneDragPreview = { id: ZoneId; polygon: Polygon }

/**
 * What the zone tool snapshots at pointerdown. `latest` mirrors what is on screen so the
 * commit does not depend on a state closure; the pointer bookkeeping around it belongs to
 * `DragGesture`.
 *
 * Neither variant carries a viewport: both convert the current pointer position through the
 * live one, so a zoom mid-gesture moves the draft with the cursor instead of detaching it.
 */
export type ZoneGesture =
  | { kind: 'draw'; map: GameMap; from: Point; latest: Rect | null }
  | {
      kind: 'move'
      target: Zone
      map: GameMap
      /** Where the press landed in the zone's own map-local space — see `PanGesture`. */
      grabbed: Point
      latest: Polygon | null
    }
  | {
      kind: 'resize'
      target: Zone
      map: GameMap
      /** Which grip of the bounding box the press took. */
      handle: ZoneHandle
      /** Where the press landed, so the polygon follows the pointer's travel, not the grip. */
      grabbed: Point
      latest: Polygon | null
    }

/**
 * **Screen** pixels a zone drag must cover on both axes before it commits. Below this the
 * gesture was a click that wobbled, and a zone a few pixels across is a region nobody can
 * select, rename or see.
 *
 * Screen rather than map-local, because map-local is not a size anyone can judge: at 8× four
 * map pixels is a rectangle you can see and drag out, and at 5% it is a twitch.
 */
export const MIN_ZONE_SIZE = 8

/**
 * **Screen** pixels around a resize grip that count as a press on it. Screen rather than
 * map-local for the reason `MIN_ZONE_SIZE` is: a fixed map-local radius would be untouchable
 * at 5% zoom and would swallow half the zone at 8x.
 *
 * A shade larger than the grip is drawn, so the grip is easier to hit than to see rather than
 * the other way round.
 */
const ZONE_HANDLE_HIT_RADIUS = 9

/** Screen pixels per map-local pixel: the viewport's zoom and the map's own scale. */
function screenScaleOf(viewport: Viewport, map: GameMap): number {
  return viewport.scale * map.scale
}

/**
 * The smallest a zone may be squeezed to, in that map's own pixels. Expressed through the
 * live screen scale so it is the same rejection `MIN_ZONE_SIZE` makes when a zone is drawn: a
 * region has to stay big enough to see, select and rename.
 */
export function minZoneSizeIn(viewport: Viewport, map: GameMap): number {
  return MIN_ZONE_SIZE / screenScaleOf(viewport, map)
}

/** Whether a just-drawn rectangle is big enough on screen to become a zone — see `MIN_ZONE_SIZE`. */
export function meetsMinZoneSize(rect: Rect, viewport: Viewport, map: GameMap): boolean {
  const screenScale = screenScaleOf(viewport, map)
  return rect.width * screenScale >= MIN_ZONE_SIZE && rect.height * screenScale >= MIN_ZONE_SIZE
}

/**
 * The grip of the selected zone under a canvas point, or `null`. Only the selected zone has
 * grips — they are drawn for it alone, and a hit test that answered for zones nobody can see
 * grips on would resize a shape the user never aimed at.
 *
 * Pure and exported so it can be tested without mounting `MapCanvas` — see CLAUDE.md §
 * Testing scope.
 */
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
  /** The zone whose resize grips are on screen, with the map they are expressed on. */
  selectedZone: { zone: Zone; map: GameMap } | null
  viewportRef: { current: Viewport }
  setPanning: (panning: boolean) => void
  onZoneDrag: (preview: ZoneDragPreview | null) => void
  showNotice: (text: string) => void
}

export type ZoneToolApi = {
  /** Whether the zone tool owns the pointer right now — `MapCanvas` reads this to arbitrate gestures. */
  ref: DragGestureRef<ZoneGesture>
  /** The rectangle being dragged out, redrawn every frame — `MapCanvas`'s own render state. */
  draft: { mapId: MapId; rect: Rect } | null
  /**
   * True when the zone tool took the press; false leaves it to the pan. A press inside an
   * existing zone moves it, a press on a grip resizes it, and a press anywhere else on a map
   * drags out a new rectangle.
   */
  begin: (event: DragPointerEvent, anchor: Point) => boolean
  move: (event: DragPointerEvent, anchor: Point) => void
  end: (event: DragPointerEvent) => void
  cancel: (event: DragPointerEvent) => boolean
}

/**
 * The zone tool's gesture, which is two gestures wearing one tool: drawing a new zone, and
 * moving or resizing an existing one through its grips.
 */
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
  // Not a prop to the memo'd `ZoneLayer`, which must stay free of anything that changes per frame.
  const [draft, setDraft] = useState<{ mapId: MapId; rect: Rect } | null>(null)

  function begin(event: DragPointerEvent, anchor: Point): boolean {
    const canvasPoint = screenToWorld(viewportRef.current, anchor)

    // Tested before the map is: a grip sitting on the very edge of a zone that was dragged
    // past the map's border is still a grip, and asking `mapAtCanvasPoint` first would hand
    // that press to the pan. It is also tested before the zone under the cursor, because
    // every grip of a zone lies on or inside its own bounding box.
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

    // `zoneAtCanvasPoint` consults only the topmost map at the point, so a hit is always a
    // zone of `map` and the two share one map-local space.
    const target = zoneAtCanvasPoint(maps, zones, canvasPoint)
    const local = canvasToMapLocal(map, canvasPoint)
    if (target !== null) {
      return beginDrag(zone, event, { kind: 'move', target, map, grabbed: local, latest: null })
    }

    return beginDrag(zone, event, { kind: 'draw', map, from: local, latest: null })
  }

  function move(event: DragPointerEvent, anchor: Point): void {
    // Drawing goes through the same threshold as every other gesture, so the draft rectangle
    // appears once the press is a drag rather than flashing under a click that wobbled.
    const moved = moveDrag(zone, event)
    if (moved === null) return
    // Guarded on the transition, as the pan is: both variants redraw the world every frame,
    // the draft rectangle as much as the zone being moved.
    if (moved.started) setPanning(true)
    const gesture = moved.data
    // Both variants want the pointer in the gesture's map-local space, through the viewport
    // as it is now — a delta divided by a scale snapshotted at pointerdown would jump the
    // moment the wheel changed that scale.
    const local = canvasToMapLocal(gesture.map, screenToWorld(viewportRef.current, anchor))

    if (gesture.kind === 'draw') {
      const rect = rectBetween(gesture.from, local)
      gesture.latest = rect
      setDraft({ mapId: gesture.map.id, rect })
      return
    }

    const travel: Point = { x: local.x - gesture.grabbed.x, y: local.y - gesture.grabbed.y }
    // Both reshape the same zone from the polygon it had at pointerdown, never from the
    // previous frame's: accumulating frame by frame would compound the floor `resizePolygon`
    // clamps at, so a drag that overshot the minimum and came back would not come back.
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
        // A press that never moved is how a zone is picked up *and* how it is selected.
        selectZone(gesture.target.id)
        return
      }
      // One action for both, because a zone is its polygon however that polygon was arrived
      // at — see the reducer.
      dispatch({ kind: 'zone/reshaped', zoneId: gesture.target.id, polygon: final })
      return
    }

    const rect = gesture.latest
    setDraft(null)
    // A click leaves no trace, and says nothing: it was never a rectangle.
    if (rect === null) return

    if (!meetsMinZoneSize(rect, viewportRef.current, gesture.map)) {
      // Said rather than silently dropped: the draft rectangle was on screen a frame ago, so
      // its disappearance needs a reason.
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

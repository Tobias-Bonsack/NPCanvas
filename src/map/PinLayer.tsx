import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../app/route.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, DialogueId, GameMap, MapId, Point } from '../project/types.ts'
import { deleteMediaFile } from '../storage/project-directory.ts'
import { mapGroupStyle } from './map-group-style.ts'

/** Screen pixels of travel before a press stops being a click and becomes a drag. */
const DRAG_THRESHOLD = 4

type DragState = {
  pointerId: number
  id: DialogueId
  origin: Point
  from: Point
  /**
   * Screen pixels per map-local pixel, read once at pointerdown: the drag must not shift if
   * the canvas is zoomed mid-gesture.
   */
  scale: number
  /** Mirrors the rendered drag position, so pointerup does not depend on a state closure. */
  latest: Point | null
  moved: boolean
}

/**
 * Pins live *inside* the world element, grouped by map and positioned in that map's own
 * coordinates, so panning, zooming, and moving a map all carry them for free — one transform
 * per map instead of N style writes.
 *
 * `memo` is load-bearing: `MapCanvas` re-renders on every pointermove while panning, and
 * every prop here is deliberately independent of the viewport so this subtree does not.
 */
export const PinLayer = memo(function PinLayer({
  maps,
  dialogues,
  selectedId,
}: {
  maps: readonly GameMap[]
  dialogues: Dialogue[]
  selectedId: DialogueId | null
}): ReactElement {
  // Only the pin being dragged re-renders from state; the drag bookkeeping itself stays in
  // a ref so a sub-threshold wobble costs no render at all.
  const drag = useRef<DragState | null>(null)
  const [dragged, setDragged] = useState<{ id: DialogueId; position: Point } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DialogueId | null>(null)

  // A confirmation belongs to the pin that was selected when it opened; leaving that pin
  // must not leave a stray prompt hanging over the map.
  useEffect(() => setPendingDelete(null), [selectedId])

  // Rebuilding this per render would hand every group a fresh array and undo the memo above,
  // which is the whole reason panning does not touch this subtree.
  const byMap = useMemo(() => groupByMap(maps, dialogues), [maps, dialogues])

  function select(id: DialogueId): void {
    dispatch({ kind: 'selection/set', selection: { kind: 'dialogue', id } })
    navigate({ kind: 'canvas', dialogueId: id })
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, dialogue: Dialogue): void {
    if (event.button !== 0) return
    // Without this the canvas underneath would start panning at the same time.
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      id: dialogue.id,
      origin: { x: event.clientX, y: event.clientY },
      from: dialogue.position,
      scale: readScreenScale(event.currentTarget),
      latest: null,
      moved: false,
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return

    const dx = event.clientX - current.origin.x
    const dy = event.clientY - current.origin.y
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    current.moved = true

    const position: Point = {
      x: current.from.x + dx / current.scale,
      y: current.from.y + dy / current.scale,
    }
    current.latest = position
    setDragged({ id: current.id, position })
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return
    event.stopPropagation()
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    // A slightly shaky click still selects — that is the whole point of the threshold.
    if (!current.moved) {
      setDragged(null)
      select(current.id)
      return
    }

    const final = current.latest
    setDragged(null)
    if (final !== null) {
      dispatch({ kind: 'dialogue/moved', dialogueId: current.id, position: final })
    }
  }

  async function onDeleteConfirmed(dialogue: Dialogue): Promise<void> {
    setPendingDelete(null)
    dispatch({ kind: 'dialogue/deleted', dialogueId: dialogue.id })
    navigate({ kind: 'canvas', dialogueId: null }, { replace: true })

    // Text dialogues own no file, but #12 makes this branch live and an orphan in media/
    // would be invisible from inside the app.
    if (dialogue.content.kind === 'text') return
    try {
      await deleteMediaFile(dialogue.content.file.fileName)
    } catch (error) {
      console.error('Could not delete media file', error)
    }
  }

  return (
    <div className="pin-layer">
      {maps.map((map) => (
        <div key={map.id} className="pin-layer__map" style={mapGroupStyle(map)}>
          {(byMap.get(map.id) ?? []).map((dialogue) => (
            <Pin
              key={dialogue.id}
              dialogue={dialogue}
              position={
                dragged !== null && dragged.id === dialogue.id ? dragged.position : dialogue.position
              }
              selected={dialogue.id === selectedId}
              confirmingDelete={pendingDelete === dialogue.id}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onRequestDelete={() => setPendingDelete(dialogue.id)}
              onCancelDelete={() => setPendingDelete(null)}
              onConfirmDelete={() => void onDeleteConfirmed(dialogue)}
            />
          ))}
        </div>
      ))}
    </div>
  )
})

/**
 * Dialogues bucketed by map, in one pass. A dialogue naming a map that is not in `maps`
 * belongs to no group and is simply not rendered — the cascade in `map/deleted` means that
 * can only be a transient mid-dispatch state, never a document a user sees.
 */
function groupByMap(
  maps: readonly GameMap[],
  dialogues: readonly Dialogue[],
): ReadonlyMap<MapId, Dialogue[]> {
  const byMap = new Map<MapId, Dialogue[]>()
  for (const map of maps) byMap.set(map.id, [])
  for (const dialogue of dialogues) byMap.get(dialogue.mapId)?.push(dialogue)
  return byMap
}

function Pin({
  dialogue,
  position,
  selected,
  confirmingDelete,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  dialogue: Dialogue
  position: Point
  selected: boolean
  confirmingDelete: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, dialogue: Dialogue) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const name = pinName(dialogue)

  // Selection is reachable from the canvas, the URL, and later the quest board, so focus
  // follows it rather than being set at the click site.
  useEffect(() => {
    if (selected && !confirmingDelete) buttonRef.current?.focus()
  }, [selected, confirmingDelete])

  return (
    <div className="pin" style={pinStyle(position)}>
      <button
        ref={buttonRef}
        type="button"
        className="pin__marker"
        data-selected={selected ? 'true' : undefined}
        aria-current={selected ? 'true' : undefined}
        title={name}
        onPointerDown={(event) => onPointerDown(event, dialogue)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          // Backspace is "go back" in a browser until something claims it.
          event.preventDefault()
          onRequestDelete()
        }}
      >
        {name}
      </button>

      {confirmingDelete && (
        <div className="pin__confirm" role="alert" data-canvas-ui>
          <span>Delete this dialogue?</span>
          <button type="button" className="pin__button pin__button--danger" autoFocus onClick={onConfirmDelete}>
            Delete
          </button>
          <button
            type="button"
            className="pin__button"
            onClick={onCancelDelete}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onCancelDelete()
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

/** A pin with no NPC yet still needs an accessible name — it is a real button. */
function pinName(dialogue: Dialogue): string {
  const trimmed = dialogue.npcName.trim()
  return trimmed === '' ? 'Unnamed NPC' : trimmed
}

/**
 * The counter-scale is CSS reading the `--map-zoom` the world element publishes, so a zoom
 * costs one custom-property write rather than a style update per pin. Only `left`/`top`
 * come from JS, and those change solely when the dialogue moves.
 */
function pinStyle(position: Point): CSSProperties {
  return { left: `${position.x}px`, top: `${position.y}px` }
}

/**
 * Screen pixels per map-local pixel: the product of the canvas zoom and the map's own scale,
 * which is exactly what a drag delta must be divided by to land in map-local coordinates.
 *
 * Read from the DOM at pointerdown rather than passed in as a prop — a `scale` prop would
 * change on every wheel notch and defeat the `memo` above. The world element publishes
 * `--map-zoom` and each map group publishes `--map-scale`; both inherit down to the pin.
 */
function readScreenScale(element: Element): number {
  const style = getComputedStyle(element)
  return readPositiveNumber(style, '--map-zoom') * readPositiveNumber(style, '--map-scale')
}

function readPositiveNumber(style: CSSStyleDeclaration, property: string): number {
  const raw = Number.parseFloat(style.getPropertyValue(property))
  return Number.isFinite(raw) && raw > 0 ? raw : 1
}

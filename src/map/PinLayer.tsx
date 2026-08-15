import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../app/route.ts'
import { ContentGlyph } from '../dialogue/ContentGlyph.tsx'
import { relevancePinBackground } from '../dialogue/relevance.ts'
import { useMediaUrl } from '../media/media-url-cache.ts'
import { dispatch } from '../project/store.ts'
import type {
  Dialogue,
  DialogueContent,
  DialogueId,
  DialogueMediaContent,
  GameMap,
  MapId,
  Point,
  Quest,
} from '../project/types.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import { deleteMediaFile } from '../storage/project-directory.ts'
import { canvasRectToMapLocal } from './canvas-layout.ts'
import type { Rect } from './geometry.ts'
import { rectContains } from './geometry.ts'
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
 * `visibleRect` is the one prop the viewport reaches, and only because `MapCanvas` waits for
 * the gesture to settle before republishing it — see `SETTLE_MS` there.
 */
export const PinLayer = memo(function PinLayer({
  maps,
  dialogues,
  selectedId,
  highlighted,
  questsByDialogue,
  visibleRect,
}: {
  maps: readonly GameMap[]
  dialogues: Dialogue[]
  selectedId: DialogueId | null
  /**
   * The dialogues every active canvas filter agrees on — a selected zone's contents, the quest
   * highlight, or the intersection of both. Everything else is dimmed. `MapScreen` combines
   * the filters so this layer never learns *why* a pin is dimmed; `null` means no filter is
   * active at all, which must not be confused with a filter that matched nothing.
   */
  highlighted: ReadonlySet<DialogueId> | null
  /**
   * The quests naming each dialogue, in document order — see `quest-index.ts`. One flag per
   * entry, so a pin in three threads looks like a pin in three threads. A dialogue in no quest
   * is simply absent from the map. A separate mark from the relevance fill, because the two
   * answer different questions about the same pin.
   */
  questsByDialogue: ReadonlyMap<DialogueId, Quest[]>
  /**
   * Canvas space. Pins outside it keep their glyph instead of reading a thumbnail off disk.
   * `null` until the container has been measured, which simply means no thumbnails yet.
   */
  visibleRect: Rect | null
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
    navigate({ kind: 'canvas', dialogueId: id, focusMapId: null })
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
    navigate({ kind: 'canvas', dialogueId: null, focusMapId: null }, { replace: true })

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
      {maps.map((map) => {
        // Converted once per map, not once per pin: the pins are already in this space.
        const visible = visibleRect === null ? null : canvasRectToMapLocal(map, visibleRect)
        return (
          <div key={map.id} className="pin-layer__map" style={mapGroupStyle(map)}>
            {(byMap.get(map.id) ?? []).map((dialogue) => (
              <Pin
                key={dialogue.id}
                dialogue={dialogue}
                position={
                  dragged !== null && dragged.id === dialogue.id
                    ? dragged.position
                    : dialogue.position
                }
                onScreen={visible !== null && rectContains(visible, dialogue.position)}
                dimmed={highlighted !== null && !highlighted.has(dialogue.id)}
                quests={questsByDialogue.get(dialogue.id) ?? NO_QUESTS}
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
        )
      })}
    </div>
  )
})

/** One shared empty array, so a pin in no quest is handed the same reference every render. */
const NO_QUESTS: readonly Quest[] = []

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
  onScreen,
  dimmed,
  quests,
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
  /** Inside the visible world rect, and therefore allowed to read a thumbnail off disk. */
  onScreen: boolean
  /** Filtered out by the zone selection or the quest highlight. Still selectable — dimmed is
   * context, not disabled. */
  dimmed: boolean
  /** Every quest naming this dialogue, in document order — one flag each, uncapped. */
  quests: readonly Quest[]
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
    <div className="pin" data-dimmed={dimmed ? 'true' : undefined} style={pinStyle(position)}>
      <button
        ref={buttonRef}
        type="button"
        className="pin__marker"
        data-selected={selected ? 'true' : undefined}
        // Drives both the min-width the bands need and the dark ink they need to be read
        // against — see the rules in MapCanvas.css.
        data-tagged={dialogue.relevance.length > 0 ? 'true' : undefined}
        aria-current={selected ? 'true' : undefined}
        style={{ background: relevancePinBackground(dialogue.relevance) }}
        title={pinTitle(name, quests)}
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
        {/* The face is transparent, so the relevance bands behind it run the full width of
            the pin; only a thumbnail is opaque. Both sit inside the button, so the whole pin
            stays one hit target. */}
        <span className="pin__face">
          <PinFace content={dialogue.content} onScreen={onScreen} />
        </span>
        <span className="pin__name">{name}</span>
        {/* A separate mark in a separate place, not another colour in the fill: the fill is
            spoken for by relevance, and a fifth band would read as a fifth tag. Decorative —
            the button's title names the quests for anyone who cannot see the flags. */}
        {quests.length > 0 && (
          <span className="pin__quests" aria-hidden="true">
            {quests.map((quest, index) => (
              // Keyed by position as well as id, because a hand-edited data.json may name the
              // same quest twice and the pin renders exactly what the document says.
              <QuestFlag key={`${quest.id}-${index}`} quest={quest} />
            ))}
          </span>
        )}
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

/**
 * A pennant on a pole, filled for the same reason `ContentGlyph` is: at this size a stroke
 * lands near a single physical pixel and reads as a smudge. A distinct *shape* above the pin,
 * so quest membership cannot be mistaken for a relevance band or a selection outline.
 *
 * The colour comes from the quest through `questAccentStyle`, which is also what turns a
 * finished quest's flag green — status is decided there and nowhere else.
 */
function QuestFlag({ quest }: { quest: Quest }): ReactElement {
  return (
    <svg
      className="pin__quest"
      style={questAccentStyle(quest)}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M3 1h1.8v14H3z M4.8 1.6h8.4l-2.2 3.2 2.2 3.2H4.8z" />
    </svg>
  )
}

/**
 * The pin's accessible name, plus the quests it belongs to. `title` rather than a visible
 * label because the flags are decorative — this is the only place the fact is stated in words.
 */
function pinTitle(name: string, quests: readonly Quest[]): string {
  if (quests.length === 0) return name
  return `${name} — ${quests.map(questTitle).join(', ')}`
}

function questTitle(quest: Quest): string {
  const trimmed = quest.name.trim()
  const named = trimmed === '' ? 'Untitled quest' : trimmed
  return quest.status === 'done' ? `${named} (done)` : named
}

/**
 * What a pin shows at a glance: a thumbnail for a still that is on screen, the content
 * kind's glyph otherwise.
 *
 * Video is deliberately never thumbnailed here. A poster frame costs a decode of the clip's
 * first packets per pin, and the panel is where a clip is meant to be watched.
 */
function PinFace({
  content,
  onScreen,
}: {
  content: DialogueContent
  onScreen: boolean
}): ReactElement {
  if (onScreen && (content.kind === 'image' || content.kind === 'gif')) {
    return <PinThumbnail content={content} />
  }
  return <ContentGlyph kind={content.kind} />
}

/**
 * Mounting is what acquires the file and unmounting what releases it, so culling a pin off
 * screen drops its reference — and the cache's 30 s deferred revoke is what keeps a pan back
 * and forth from re-reading the same bytes.
 */
function PinThumbnail({ content }: { content: DialogueMediaContent }): ReactElement {
  const media = useMediaUrl(content.file)
  // Loading, missing and failed all fall back to the glyph: a pin is too small to explain
  // itself, and the panel says what went wrong when the dialogue is opened.
  if (media.kind !== 'ready') return <ContentGlyph kind={content.kind} />
  return <img className="pin__thumb" src={media.url} alt="" draggable={false} />
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

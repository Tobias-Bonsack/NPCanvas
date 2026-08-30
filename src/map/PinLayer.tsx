import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { EditableRowDeleteConfirm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { navigate } from '../app/route.ts'
import { selectDialogue } from '../app/select.ts'
import { ContentGlyph } from '../dialogue/ContentGlyph.tsx'
import { relevanceHues, relevancePinBackground } from '../dialogue/relevance.ts'
import { useMediaUrl } from '../media/media-url-cache.ts'
import { dispatch } from '../project/store.ts'
import type {
  Dialogue,
  DialogueId,
  DialogueMedia,
  GameMap,
  MapId,
  Point,
  Quest,
  RelevanceTagId,
} from '../project/types.ts'
import { dialogueContentKind } from '../project/types.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { canvasRectToMapLocal } from './canvas-layout.ts'
import type { DragGesture } from './drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from './drag-gesture.ts'
import type { Rect } from './geometry.ts'
import { rectContains } from './geometry.ts'
import { mapGroupStyle } from './map-group-style.ts'

type PinHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, dialogue: Dialogue) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onDelete: (dialogue: Dialogue) => void
}

/** Exported so `MapScreen` can hold it and hand it to `TrailLayer`. */
export type PinDragPreview = { id: DialogueId; position: Point }

type PinDragGesture = {
  id: DialogueId
  position: Point
  client: Point
}

/**
 * `memo`'d: `MapCanvas` re-renders every pointermove while panning, so no prop here may be
 * viewport-derived except `visibleRect`, which `MapCanvas` only republishes once a gesture
 * settles — see `SETTLE_MS` there.
 */
export const PinLayer = memo(function PinLayer({
  maps,
  dialogues,
  selectedId,
  highlighted,
  questsByDialogue,
  relevanceHueByTag,
  visibleRect,
  suppressFocusId,
  pickReferenceFor,
  onReferencePicked,
  onPinSelected,
  onPinDrag,
}: {
  maps: readonly GameMap[]
  dialogues: Dialogue[]
  selectedId: DialogueId | null
  highlighted: ReadonlySet<DialogueId> | null
  questsByDialogue: ReadonlyMap<DialogueId, Quest[]>
  relevanceHueByTag: ReadonlyMap<RelevanceTagId, number>
  visibleRect: Rect | null
  suppressFocusId: DialogueId | null
  /** Set while DialogueReferences is waiting for the next pin click to name its partner. */
  pickReferenceFor: DialogueId | null
  onReferencePicked: (targetId: DialogueId) => void
  onPinSelected: (dialogueId: DialogueId) => void
  onPinDrag: (preview: PinDragPreview | null) => void
}): ReactElement {
  const drag = useRef<DragGesture<PinDragGesture> | null>(null)
  const [dragged, setDragged] = useState<PinDragPreview | null>(null)

  // Refs, not deps: keeps the handlers' useCallback lists empty so memo(Pin) holds.
  const onPinSelectedRef = useRef(onPinSelected)
  const onPinDragRef = useRef(onPinDrag)
  const pickReferenceForRef = useRef(pickReferenceFor)
  const onReferencePickedRef = useRef(onReferencePicked)
  useEffect(() => {
    onPinSelectedRef.current = onPinSelected
    onPinDragRef.current = onPinDrag
    pickReferenceForRef.current = pickReferenceFor
    onReferencePickedRef.current = onReferencePicked
  })

  // Keyed on the dialogues alone, deliberately: `maps` is a fresh array on every frame of a
  // map drag, and bucketing against it would rebuild every group per frame because one map
  // moved. Which map a dialogue belongs to is written on the dialogue, so the maps are not
  // needed to answer it — a bucket for a map that no longer exists is simply never read.
  const byMap = useMemo(() => groupByMap(dialogues), [dialogues])

  // Stable handlers, so memo(Pin) holds: none close over props or state.
  const onPointerDown = useCallback(function onPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    dialogue: Dialogue,
  ): void {
    if (event.button !== 0) return
    event.stopPropagation() // else the canvas underneath starts panning too
    beginDrag(drag, event, {
      id: dialogue.id,
      position: dialogue.position,
      client: { x: event.clientX, y: event.clientY },
    })
  }, [])

  const onPointerMove = useCallback(function onPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    const move = moveDrag(drag, event)
    if (move === null) return

    const scale = readScreenScale(event.currentTarget) // re-read each move: the wheel still works mid-drag
    const position: Point = {
      x: move.data.position.x + (event.clientX - move.data.client.x) / scale,
      y: move.data.position.y + (event.clientY - move.data.client.y) / scale,
    }
    move.data.position = position
    move.data.client = { x: event.clientX, y: event.clientY }
    setDragged({ id: move.data.id, position })
    onPinDragRef.current({ id: move.data.id, position })
  }, [])

  const onPointerUp = useCallback(function onPointerUp(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (event.button !== 0) return // ignore a right-button release during a held left-press
    const end = commitDrag(drag, event)
    if (end === null) return
    event.stopPropagation()
    setDragged(null)
    onPinDragRef.current(null) // before the dispatch, so nothing sees preview and document at once

    if (!end.moved) {
      const pickingFor = pickReferenceForRef.current
      if (pickingFor !== null) {
        // A click on the dialogue that is itself picking is not a partner — reducer guards
        // self-reference too, but staying armed here (instead of resolving to nothing) reads
        // as "still waiting for a click", not a silent no-op.
        if (pickingFor !== end.data.id) {
          dispatch({ kind: 'dialogue/reference-added', dialogueId: pickingFor, referenceId: end.data.id })
          onReferencePickedRef.current(end.data.id)
        }
        return
      }
      select(end.data.id)
      onPinSelectedRef.current(end.data.id)
      return
    }

    dispatch({ kind: 'dialogue/moved', dialogueId: end.data.id, position: end.data.position })
  }, [])

  // Cancel snaps back to the document position; nothing is dispatched.
  const onPointerCancel = useCallback(function onPointerCancel(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (!cancelDrag(drag, event)) return
    setDragged(null)
    onPinDragRef.current(null)
  }, [])

  const onDelete = useCallback((dialogue: Dialogue) => {
    void onDeleteConfirmed(dialogue)
  }, [])

  async function onDeleteConfirmed(dialogue: Dialogue): Promise<void> {
    dispatch({ kind: 'dialogue/deleted', dialogueId: dialogue.id })
    navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
    for (const medium of dialogue.media) await discardMediaFile(medium.file.fileName)
  }

  const handlers = useMemo<PinHandlers>(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDelete }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDelete],
  )

  return (
    <div className="pin-layer">
      {maps.map((map) => (
        <PinMapGroup
          key={map.id}
          map={map}
          dialogues={byMap.get(map.id) ?? NO_DIALOGUES}
          selectedId={selectedId}
          highlighted={highlighted}
          questsByDialogue={questsByDialogue}
          relevanceHueByTag={relevanceHueByTag}
          visibleRect={visibleRect}
          dragged={dragged}
          suppressFocusId={suppressFocusId}
          handlers={handlers}
        />
      ))}
    </div>
  )
})

// memo'd on the map object: a map drag hands down a fresh `maps` array every frame, but only
// the dragged map's object inside it changes identity, so every other group bails.
const PinMapGroup = memo(function PinMapGroup({
  map,
  dialogues,
  selectedId,
  highlighted,
  questsByDialogue,
  relevanceHueByTag,
  visibleRect,
  dragged,
  suppressFocusId,
  handlers,
}: {
  map: GameMap
  /** This map's dialogues, in document order. */
  dialogues: readonly Dialogue[]
  selectedId: DialogueId | null
  highlighted: ReadonlySet<DialogueId> | null
  questsByDialogue: ReadonlyMap<DialogueId, Quest[]>
  relevanceHueByTag: ReadonlyMap<RelevanceTagId, number>
  visibleRect: Rect | null
  dragged: PinDragPreview | null
  suppressFocusId: DialogueId | null
  handlers: PinHandlers
}): ReactElement {
  const visible = useMemo(
    () => (visibleRect === null ? null : canvasRectToMapLocal(map, visibleRect)),
    [map, visibleRect],
  )

  // Off-screen pins are removed from the DOM entirely (cost measured in MapCanvas.css); the
  // selected pin is always kept so #/canvas?dialogue=<id> can still focus it.
  const shown = useMemo(() => {
    if (visible === null) return dialogues
    return dialogues.filter(
      (dialogue) => rectContains(visible, dialogue.position) || dialogue.id === selectedId,
    )
  }, [dialogues, visible, selectedId])

  return (
    <div className="pin-layer__map" style={mapGroupStyle(map)}>
      {shown.map((dialogue) => (
        <Pin
          key={dialogue.id}
          dialogue={dialogue}
          position={
            dragged !== null && dragged.id === dialogue.id ? dragged.position : dialogue.position
          }
          onScreen={visible !== null && rectContains(visible, dialogue.position)}
          dimmed={highlighted !== null && !highlighted.has(dialogue.id)}
          quests={questsByDialogue.get(dialogue.id) ?? NO_QUESTS}
          relevanceHueByTag={relevanceHueByTag}
          selected={dialogue.id === selectedId}
          suppressFocus={dialogue.id === suppressFocusId}
          handlers={handlers}
        />
      ))}
    </div>
  )
})

function select(id: DialogueId): void {
  selectDialogue(id)
}

const NO_QUESTS: readonly Quest[] = []
const NO_DIALOGUES: readonly Dialogue[] = []

function groupByMap(dialogues: readonly Dialogue[]): ReadonlyMap<MapId, Dialogue[]> {
  const byMap = new Map<MapId, Dialogue[]>()
  for (const dialogue of dialogues) {
    const bucket = byMap.get(dialogue.mapId)
    if (bucket === undefined) byMap.set(dialogue.mapId, [dialogue])
    else bucket.push(dialogue)
  }
  return byMap
}

// memo'd: the layer re-renders on every pointermove of a pin drag; `position` is the only prop
// that changes per frame, and only for the pin being dragged.
const Pin = memo(function Pin({
  dialogue,
  position,
  onScreen,
  dimmed,
  quests,
  relevanceHueByTag,
  selected,
  suppressFocus,
  handlers,
}: {
  dialogue: Dialogue
  position: Point
  onScreen: boolean
  dimmed: boolean
  quests: readonly Quest[]
  relevanceHueByTag: ReadonlyMap<RelevanceTagId, number>
  selected: boolean
  suppressFocus: boolean
  handlers: PinHandlers
}): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const name = pinName(dialogue)
  const questsId = useId()
  const editable = useEditableRow()

  // Ref, not a dep: the controller object wrapping `close` is a fresh literal every render.
  const closeEditableRef = useRef(editable.close)
  useEffect(() => {
    closeEditableRef.current = editable.close
  })
  useEffect(() => {
    if (!selected) closeEditableRef.current()
  }, [selected])

  const suppressFocusRef = useRef(suppressFocus)
  useEffect(() => {
    suppressFocusRef.current = suppressFocus
  })

  // suppressFocus is read via ref, not as a dependency: MapScreen clears it one render after a
  // placement, and including it here would steal focus back from the field that just claimed it.
  // preventScroll matters because .map-canvas is overflow:hidden but still scrollable — a cold
  // #/canvas?dialogue=<id> load would otherwise scroll it and skew every coordinate conversion.
  useEffect(() => {
    if (selected && editable.mode !== 'delete' && !suppressFocusRef.current) {
      buttonRef.current?.focus({ preventScroll: true })
    }
  }, [selected, editable.mode])

  return (
    <div className="pin" data-dimmed={dimmed ? 'true' : undefined} style={pinStyle(position)}>
      <button
        ref={buttonRef}
        type="button"
        className="pin__marker"
        data-selected={selected ? 'true' : undefined}
        data-tagged={dialogue.relevance.length > 0 ? 'true' : undefined}
        aria-current={selected ? 'true' : undefined}
        style={{ background: relevancePinBackground(relevanceHues(dialogue.relevance, relevanceHueByTag)) }}
        title={name}
        aria-describedby={quests.length > 0 ? questsId : undefined}
        onPointerDown={(event) => handlers.onPointerDown(event, dialogue)}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          event.preventDefault() // Backspace is browser "go back" until something claims it
          editable.openDelete()
        }}
      >
        <span className="pin__face">
          <PinFace dialogue={dialogue} onScreen={onScreen} />
        </span>
        <span className="pin__name">{name}</span>
        {quests.length > 0 && (
          <span className="pin__quests" aria-hidden="true">
            {quests.map((quest, index) => (
              // keyed by position too: a hand-edited data.json may name the same quest twice
              <QuestFlag key={`${quest.id}-${index}`} quest={quest} />
            ))}
          </span>
        )}
        {quests.length > 0 && (
          <span id={questsId} className="visually-hidden">
            In {quests.map(questTitle).join(', ')}
          </span>
        )}
      </button>

      {editable.mode === 'delete' && (
        <EditableRowDeleteConfirm
          message="Delete this dialogue?"
          onConfirm={() => handlers.onDelete(dialogue)}
          close={editable.close}
          className="pin__confirm"
          label={`Delete ${name}?`}
          buttonClassName="pin__button"
          dangerButtonClassName="pin__button pin__button--danger"
          dataCanvasUi
        />
      )}
    </div>
  )
})

// Filled, not stroked, like ContentGlyph — at this size a stroke reads as a smudge.
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

function questTitle(quest: Quest): string {
  const trimmed = quest.name.trim()
  const named = trimmed === '' ? 'Untitled quest' : trimmed
  return quest.status === 'done' ? `${named} (done)` : named
}

// Only the first medium, and video is never thumbnailed here (a poster frame would decode the
// clip's first packets per pin) — the panel is where a clip is meant to be watched.
function PinFace({
  dialogue,
  onScreen,
}: {
  dialogue: Dialogue
  onScreen: boolean
}): ReactElement {
  const kind = dialogueContentKind(dialogue)
  if (onScreen && (kind === 'image' || kind === 'gif')) {
    return <PinThumbnail media={dialogue.media[0]} />
  }
  return <ContentGlyph kind={kind} />
}

// Object URLs are ref-counted (media-url-cache.ts); mount/unmount is acquire/release.
function PinThumbnail({ media }: { media: DialogueMedia }): ReactElement {
  const url = useMediaUrl(media.file)
  if (url.kind !== 'ready') return <ContentGlyph kind={media.kind} />
  return <img className="pin__thumb" src={url.url} alt="" draggable={false} />
}

function pinName(dialogue: Dialogue): string {
  const trimmed = dialogue.npcName.trim()
  return trimmed === '' ? 'Unnamed NPC' : trimmed
}

function pinStyle(position: Point): CSSProperties {
  return { left: `${position.x}px`, top: `${position.y}px` }
}

// Read from the DOM, not a prop — a `scale` prop would change every wheel notch and defeat the
// memo above. --map-zoom (world) and --map-scale (map group) both inherit down to the pin.
function readScreenScale(element: Element): number {
  const style = getComputedStyle(element)
  return readPositiveNumber(style, '--map-zoom') * readPositiveNumber(style, '--map-scale')
}

function readPositiveNumber(style: CSSStyleDeclaration, property: string): number {
  const raw = Number.parseFloat(style.getPropertyValue(property))
  return Number.isFinite(raw) && raw > 0 ? raw : 1
}

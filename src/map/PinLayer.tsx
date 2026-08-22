import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { navigate } from '../app/route.ts'
import { ContentGlyph } from '../dialogue/ContentGlyph.tsx'
import { relevanceHues, relevancePinBackground } from '../dialogue/relevance.ts'
import { useAlertDialogFocus } from '../dialog-focus.ts'
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

/**
 * Everything a pin does back to the layer. One object rather than seven props, because they
 * are created once and change together (never), so one reference comparison stands in for
 * seven and both `PinMapGroup` and `Pin` keep a readable prop list.
 */
type PinHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, dialogue: Dialogue) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onRequestDelete: (dialogue: Dialogue) => void
  onCancelDelete: () => void
  onConfirmDelete: (dialogue: Dialogue) => void
}

/** The live position of the pin being dragged, or `null` when none is. */
type PinDrag = { id: DialogueId; position: Point }

/** What a pin drag carries; `DragGesture` owns the pointer bookkeeping. */
type PinDragGesture = {
  id: DialogueId
  /**
   * The live map-local position, advanced by each move rather than recomputed from the press.
   * Only the increment *since the last move* belongs to the scale in force now, so a canvas
   * zoom mid-drag changes what the next pixel is worth without re-scaling the travel so far.
   * It also mirrors what is rendered, so pointerup depends on no state closure.
   */
  position: Point
  /** Client coordinates of the previous move — the other half of that increment. */
  client: Point
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
  relevanceHueByTag,
  visibleRect,
  suppressFocusId,
  onPinSelected,
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
   * The project's own relevance hues, by tag id — built in `MapScreen` with `useMemo` on the
   * identity of `project.relevanceTags`, which is what keeps this document state rather than
   * viewport state and preserves the memo boundary above.
   */
  relevanceHueByTag: ReadonlyMap<RelevanceTagId, number>
  /**
   * Canvas space, already grown by `CULL_MARGIN` — pins outside it are not rendered at all.
   * It is republished only when the view settles, which is what keeps culling from costing a
   * per-pin update mid-gesture. `null` until the container has been measured, which means
   * every pin renders: "not measured yet" must not read as "nothing is visible".
   */
  visibleRect: Rect | null
  /**
   * A dialogue that was just placed and whose form, not its pin, is owed the initial focus —
   * see #45 and `MapScreen`'s `onDialoguePlaced`. `null` for every ordinary selection, which is
   * what leaves the pin's own focus-follow effect untouched for a click, a link, or the search
   * palette.
   */
  suppressFocusId: DialogueId | null
  /**
   * Told about a selection made by an actual pointerup on a pin — never called for a
   * programmatic selection (a link, the search palette, a cold `?dialogue=<id>` load). This is
   * what lets `DialoguePanel` tell "this pin already has the focus it needs" apart from "focus
   * has to be moved into the panel" on open. Fired through a ref inside the layer, so it can
   * stay out of `onPointerUp`'s dependency list — see the handlers below.
   */
  onPinSelected: (dialogueId: DialogueId) => void
}): ReactElement {
  // Only the pin being dragged re-renders from state; the drag bookkeeping itself stays in
  // a ref so a sub-threshold wobble costs no render at all.
  const drag = useRef<DragGesture<PinDragGesture> | null>(null)
  const [dragged, setDragged] = useState<PinDrag | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DialogueId | null>(null)

  // A ref rather than a dependency: `onPointerUp` is a stable `useCallback` with an empty
  // dependency list, which is what keeps `memo(Pin)` from reconciling on every render of this
  // layer — see the comment above `handlers`.
  const onPinSelectedRef = useRef(onPinSelected)
  useEffect(() => {
    onPinSelectedRef.current = onPinSelected
  })

  // A confirmation belongs to the pin that was selected when it opened; leaving that pin
  // must not leave a stray prompt hanging over the map.
  useEffect(() => setPendingDelete(null), [selectedId])

  // Keyed on the dialogues alone, deliberately: `maps` is a fresh array on every frame of a
  // map drag, and bucketing against it would rebuild every group per frame because one map
  // moved. Which map a dialogue belongs to is written on the dialogue, so the maps are not
  // needed to answer it — a bucket for a map that no longer exists is simply never read.
  const byMap = useMemo(() => groupByMap(dialogues), [dialogues])

  // Every handler handed to a pin is stable for the life of the layer, which is what makes
  // `memo(Pin)` hold: one fresh arrow per render would fail the prop comparison whatever else
  // matched, and a single pin's drag or delete prompt would reconcile the whole list again.
  // None of them close over props or state — the drag ref and the setters are all they need,
  // and the pin they act on arrives as an argument.
  const onPointerDown = useCallback(function onPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    dialogue: Dialogue,
  ): void {
    if (event.button !== 0) return
    // Without this the canvas underneath would start panning at the same time.
    event.stopPropagation()
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

    // Read every move, not once at pointerdown: the canvas zoom is what this converts by, and
    // the wheel keeps working while a pin is held.
    const scale = readScreenScale(event.currentTarget)
    const position: Point = {
      x: move.data.position.x + (event.clientX - move.data.client.x) / scale,
      y: move.data.position.y + (event.clientY - move.data.client.y) / scale,
    }
    move.data.position = position
    move.data.client = { x: event.clientX, y: event.clientY }
    setDragged({ id: move.data.id, position })
  }, [])

  const onPointerUp = useCallback(function onPointerUp(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    // The released button, not the held one: a right-button release during a held left-press
    // must not select the pin or commit its position.
    if (event.button !== 0) return
    const end = commitDrag(drag, event)
    if (end === null) return
    event.stopPropagation()
    setDragged(null)

    // A slightly shaky click still selects — that is the whole point of the threshold.
    if (!end.moved) {
      select(end.data.id)
      onPinSelectedRef.current(end.data.id)
      return
    }

    dispatch({ kind: 'dialogue/moved', dialogueId: end.data.id, position: end.data.position })
  }, [])

  /**
   * The platform withdrew the gesture, so the pin snaps back to where the document says it is
   * and nothing is dispatched — a cancel is not a shorter pointerup.
   */
  const onPointerCancel = useCallback(function onPointerCancel(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (cancelDrag(drag, event)) setDragged(null)
  }, [])

  // The pin comes back as an argument rather than being closed over, which is the whole reason
  // these three can be stable at all.
  const onRequestDelete = useCallback((dialogue: Dialogue) => setPendingDelete(dialogue.id), [])
  const onCancelDelete = useCallback(() => setPendingDelete(null), [])
  const onConfirmDelete = useCallback((dialogue: Dialogue) => {
    void onDeleteConfirmed(dialogue)
  }, [])

  async function onDeleteConfirmed(dialogue: Dialogue): Promise<void> {
    setPendingDelete(null)
    dispatch({ kind: 'dialogue/deleted', dialogueId: dialogue.id })
    navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })

    // Every file the dialogue owned, not just the first: nothing names them once the dialogue
    // is gone, and an orphan in media/ is invisible from inside the app.
    for (const medium of dialogue.media) await discardMediaFile(medium.file.fileName)
  }

  const handlers = useMemo<PinHandlers>(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onRequestDelete,
      onCancelDelete,
      onConfirmDelete,
    }),
    [
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onRequestDelete,
      onCancelDelete,
      onConfirmDelete,
    ],
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
          pendingDelete={pendingDelete}
          suppressFocusId={suppressFocusId}
          handlers={handlers}
        />
      ))}
    </div>
  )
})

/**
 * One map's pins, in that map's own coordinates. Memoized on the map object, which is what
 * makes a map drag cost one group: `MapScreen` hands down a fresh `maps` array on every frame
 * of one, but only the dragged map's object inside it is new, so every other group bails.
 */
const PinMapGroup = memo(function PinMapGroup({
  map,
  dialogues,
  selectedId,
  highlighted,
  questsByDialogue,
  relevanceHueByTag,
  visibleRect,
  dragged,
  pendingDelete,
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
  dragged: PinDrag | null
  pendingDelete: DialogueId | null
  suppressFocusId: DialogueId | null
  handlers: PinHandlers
}): ReactElement {
  // Converted once per map, not once per pin: the pins are already in this space.
  const visible = useMemo(
    () => (visibleRect === null ? null : canvasRectToMapLocal(map, visibleRect)),
    [map, visibleRect],
  )

  /**
   * What is off screen is not in the DOM. A pin is a flex `<button>` with a border, a radius,
   * a gradient, a counter-scale transform and a flag per quest, and every one of them is
   * rasterised on every frame of a pan — see the measurement in `MapCanvas.css`.
   *
   * The selected pin is kept whatever the rect says: selection drives focus, and a focus
   * effect on an element that only exists when the viewport happens to contain it would make
   * `#/canvas?dialogue=<id>` land on nothing.
   */
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
          confirmingDelete={pendingDelete === dialogue.id}
          suppressFocus={dialogue.id === suppressFocusId}
          handlers={handlers}
        />
      ))}
    </div>
  )
})

/**
 * Module scope, not a closure: it reads nothing from the layer, and `onPointerUp` is a
 * `useCallback` whose dependency list must stay empty for `memo(Pin)` to hold.
 */
function select(id: DialogueId): void {
  dispatch({ kind: 'selection/set', selection: { kind: 'dialogue', id } })
  // `replace`: selecting a pin refines what the panel shows rather than opening a new page, so
  // ten pins clicked in a row must not push ten history entries — see CLAUDE.md's view-state note.
  navigate({ kind: 'canvas', dialogueId: id, focus: null }, { replace: true })
}

/** One shared empty array, so a pin in no quest is handed the same reference every render. */
const NO_QUESTS: readonly Quest[] = []

/** Likewise for a map that carries no dialogue yet. */
const NO_DIALOGUES: readonly Dialogue[] = []

/**
 * Dialogues bucketed by map, in one pass. A dialogue naming a map the project does not have
 * lands in a bucket nothing renders — the cascade in `map/deleted` means that can only be a
 * transient mid-dispatch state, never a document a user sees.
 */
function groupByMap(dialogues: readonly Dialogue[]): ReadonlyMap<MapId, Dialogue[]> {
  const byMap = new Map<MapId, Dialogue[]>()
  for (const dialogue of dialogues) {
    const bucket = byMap.get(dialogue.mapId)
    if (bucket === undefined) byMap.set(dialogue.mapId, [dialogue])
    else bucket.push(dialogue)
  }
  return byMap
}

/**
 * One pin. Memoized, because the layer above re-renders on every `pointermove` of a pin drag
 * and on every delete prompt: without this, moving one pin reconciles all N. Every prop is
 * either a primitive, a document object, or one of the layer's stable handlers — `position`
 * is the only one that changes per frame, and only for the pin being dragged.
 */
const Pin = memo(function Pin({
  dialogue,
  position,
  onScreen,
  dimmed,
  quests,
  relevanceHueByTag,
  selected,
  confirmingDelete,
  suppressFocus,
  handlers,
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
  relevanceHueByTag: ReadonlyMap<RelevanceTagId, number>
  selected: boolean
  confirmingDelete: boolean
  /** This pin was just placed, so its dialogue's own NPC field is claiming focus instead — see
   *  `MapScreen`'s `onDialoguePlaced`. */
  suppressFocus: boolean
  handlers: PinHandlers
}): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const name = pinName(dialogue)
  const questsId = useId()

  // Read inside the effect below without being one of its dependencies — see there for why.
  const suppressFocusRef = useRef(suppressFocus)
  useEffect(() => {
    suppressFocusRef.current = suppressFocus
  })

  // Selection is reachable from the canvas, the URL, and later the quest board, so focus
  // follows it rather than being set at the click site — except right after a placement, where
  // the dialogue's own form claims it instead of the pin.
  //
  // `suppressFocus` deliberately is not in this effect's own dependency array: `MapScreen`
  // clears it one render after a placement (once the form has consumed it), and a dependency
  // list that included it would re-run this effect on that *second* render with the guard now
  // open — stealing focus right back from the field that just claimed it. Reading the ref
  // instead means only a real transition of `selected`/`confirmingDelete` is ever a decision
  // point; the suppression is only ever consulted at the moment selection actually happens.
  //
  // `preventScroll` is load-bearing, not a nicety: the pin sits inside `.map-canvas`, which is
  // `overflow: hidden` and therefore still *scrollable*. Focusing a pin outside the visible
  // box — a cold load of `#/canvas?dialogue=<id>` from an Insights or quest-board link — would
  // otherwise make the browser scroll the container, and every coordinate conversion after
  // that is off by the offset. See the scroll guard in `MapCanvas`.
  useEffect(() => {
    if (selected && !confirmingDelete && !suppressFocusRef.current) {
      buttonRef.current?.focus({ preventScroll: true })
    }
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
        style={{ background: relevancePinBackground(relevanceHues(dialogue.relevance, relevanceHueByTag)) }}
        // A tooltip only, now — the accessible name already comes from `pin__name`'s visible
        // text, so this must not carry anything that name does not, or the two would disagree
        // for a sighted mouse user versus everyone else. The quests are a *description*, not
        // part of the name — see `aria-describedby` below.
        title={name}
        aria-describedby={quests.length > 0 ? questsId : undefined}
        onPointerDown={(event) => handlers.onPointerDown(event, dialogue)}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          // Backspace is "go back" in a browser until something claims it.
          event.preventDefault()
          handlers.onRequestDelete(dialogue)
        }}
      >
        {/* The face is transparent, so the relevance bands behind it run the full width of
            the pin; only a thumbnail is opaque. Both sit inside the button, so the whole pin
            stays one hit target. */}
        <span className="pin__face">
          <PinFace dialogue={dialogue} onScreen={onScreen} />
        </span>
        <span className="pin__name">{name}</span>
        {/* A separate mark in a separate place, not another colour in the fill: the fill is
            spoken for by relevance, and a fifth band would read as a fifth tag. Decorative —
            the hidden text below names the quests for anyone who cannot see the flags. */}
        {quests.length > 0 && (
          <span className="pin__quests" aria-hidden="true">
            {quests.map((quest, index) => (
              // Keyed by position as well as id, because a hand-edited data.json may name the
              // same quest twice and the pin renders exactly what the document says.
              <QuestFlag key={`${quest.id}-${index}`} quest={quest} />
            ))}
          </span>
        )}
        {/* The description `aria-describedby` above points at — present in the accessibility
            tree without being read as part of the button's name, and without a `title`
            tooltip's information being reachable only by hovering. */}
        {quests.length > 0 && (
          <span id={questsId} className="visually-hidden">
            In {quests.map(questTitle).join(', ')}
          </span>
        )}
      </button>

      {confirmingDelete && (
        <PinDeleteConfirm
          dialogue={dialogue}
          onCancel={handlers.onCancelDelete}
          onConfirm={handlers.onConfirmDelete}
        />
      )}
    </div>
  )
})

/**
 * Its own component, not inline JSX in `Pin`: `useAlertDialogFocus` is a hook, and hooks cannot
 * be called from inside the `confirmingDelete &&` branch of a function that also returns without
 * it — mounting and unmounting *this* component is what mount/unmount means to the hook.
 */
function PinDeleteConfirm({
  dialogue,
  onCancel,
  onConfirm,
}: {
  dialogue: Dialogue
  onCancel: () => void
  onConfirm: (dialogue: Dialogue) => void
}): ReactElement {
  const ref = useAlertDialogFocus(onCancel)
  return (
    <div
      ref={ref}
      className="pin__confirm"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Delete ${pinName(dialogue)}?`}
      tabIndex={-1}
      data-canvas-ui
    >
      <span>Delete this dialogue?</span>
      <button
        type="button"
        className="pin__button pin__button--danger"
        onClick={() => onConfirm(dialogue)}
      >
        Delete
      </button>
      <button type="button" className="pin__button" onClick={onCancel}>
        Cancel
      </button>
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

function questTitle(quest: Quest): string {
  const trimmed = quest.name.trim()
  const named = trimmed === '' ? 'Untitled quest' : trimmed
  return quest.status === 'done' ? `${named} (done)` : named
}

/**
 * What a pin shows at a glance: a thumbnail for a still that is on screen, the content
 * kind's glyph otherwise. Only the **first** medium — a pin is a few screen pixels, and a
 * dialogue that carries five frames of one line still marks one place on the map.
 *
 * Video is deliberately never thumbnailed here. A poster frame costs a decode of the clip's
 * first packets per pin, and the panel is where a clip is meant to be watched.
 */
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

/**
 * Mounting is what acquires the file and unmounting what releases it, so culling a pin off
 * screen drops its reference — and the cache's 30 s deferred revoke is what keeps a pan back
 * and forth from re-reading the same bytes.
 */
function PinThumbnail({ media }: { media: DialogueMedia }): ReactElement {
  const url = useMediaUrl(media.file)
  // Loading, missing and failed all fall back to the glyph: a pin is too small to explain
  // itself, and the panel says what went wrong when the dialogue is opened.
  if (url.kind !== 'ready') return <ContentGlyph kind={media.kind} />
  return <img className="pin__thumb" src={url.url} alt="" draggable={false} />
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
 * Read from the DOM rather than passed in as a prop — a `scale` prop would change on every
 * wheel notch and defeat the `memo` above. The world element publishes `--map-zoom` and each
 * map group publishes `--map-scale`; both inherit down to the pin.
 *
 * Read per move rather than once per gesture, because the value is exactly what a zoom
 * changes. The cost is one computed-style read on a single element, in a handler that already
 * re-renders that pin — and it happens after the browser has recalculated for the last frame,
 * so it flushes nothing extra.
 */
function readScreenScale(element: Element): number {
  const style = getComputedStyle(element)
  return readPositiveNumber(style, '--map-zoom') * readPositiveNumber(style, '--map-scale')
}

function readPositiveNumber(style: CSSStyleDeclaration, property: string): number {
  const raw = Number.parseFloat(style.getPropertyValue(property))
  return Number.isFinite(raw) && raw > 0 ? raw : 1
}

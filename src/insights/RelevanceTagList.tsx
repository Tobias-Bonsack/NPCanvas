import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { assertNever } from '../assert-never.ts'
import { RELEVANCE_HUES, nextRelevanceHue, relevanceHueStyle } from '../dialogue/relevance.ts'
import type { DragGesture } from '../map/drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from '../map/drag-gesture.ts'
import type { RowTrigger } from '../map/row-focus.ts'
import { useRowFocus } from '../map/row-focus.ts'
import { newRelevanceTagId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, RelevanceTag, RelevanceTagId } from '../project/types.ts'
import { useFieldDraft } from '../use-field-draft.ts'
import type { DialogueFilter } from './filters.ts'

/**
 * What a tag's drag carries; `DragGesture` owns the pointer bookkeeping. `toIndex` is advanced
 * by each move rather than read back from the `dragPreview` state at commit time — a commit can
 * land in the same tick as the move that produced it, before React has re-rendered with the new
 * state, and reading stale state there would dispatch the *previous* target index. Mirrors
 * `PinLayer`'s `PinDragGesture.position`, which is live for the same reason.
 */
type TagDragData = { id: RelevanceTagId; startIndex: number; rowHeight: number; toIndex: number }

/** The live target position of the tag being dragged — component state, never the store; see
 *  the comment on `PinLayer`'s own `PinDrag` for why a dispatch per move is the wrong shape. */
type TagDragPreview = { id: RelevanceTagId; toIndex: number }

/** Only a fallback if a row's own measured height is somehow unavailable at drag start. */
const DEFAULT_ROW_HEIGHT = 32

/**
 * Transient list UI — the rename draft, the open palette, the delete confirmation — is
 * component state, never the store. See CLAUDE.md § Store scope. One mode for the whole list
 * rather than one per row, because only one row can be mid-edit — the same shape `ZoneList` and
 * `QuestBoard` already use.
 */
type RelevanceTagListMode =
  | { kind: 'idle' }
  | { kind: 'renaming'; id: RelevanceTagId }
  | { kind: 'recolouring'; id: RelevanceTagId }
  | { kind: 'confirming-delete'; id: RelevanceTagId }

/**
 * The relevance vocabulary, as a list a user edits — insights is where a tag is already *read*
 * (the filter chips, the breakdown panel), so it is where a tag is edited too, rather than a
 * fourth nav entry for a handful of records.
 */
export function RelevanceTagList({
  relevanceTags,
  dialogues,
  filter,
  onFilterChange,
}: {
  relevanceTags: readonly RelevanceTag[]
  dialogues: readonly Dialogue[]
  filter: DialogueFilter
  onFilterChange: (filter: DialogueFilter) => void
}): ReactElement {
  const [mode, setMode] = useState<RelevanceTagListMode>({ kind: 'idle' })

  // The drag gesture's own bookkeeping lives in a ref, exactly as `PinLayer`'s does; only the
  // live preview it produces is state, so a pointermove costs a re-render of this list and
  // nothing else.
  const dragRef = useRef<DragGesture<TagDragData> | null>(null)
  const [dragPreview, setDragPreview] = useState<TagDragPreview | null>(null)

  function createTag(): void {
    const tag: RelevanceTag = {
      id: newRelevanceTagId(),
      name: '',
      hue: nextRelevanceHue(relevanceTags),
    }
    dispatch({ kind: 'relevance-tag/added', tag })
    // Straight into renaming: a nameless tag in a list is nothing to click on.
    setMode({ kind: 'renaming', id: tag.id })
  }

  function onHandlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    tag: RelevanceTag,
    index: number,
  ): void {
    if (event.button !== 0) return
    const row = event.currentTarget.closest('li')
    const rowHeight = row?.getBoundingClientRect().height ?? DEFAULT_ROW_HEIGHT
    beginDrag(dragRef, event, { id: tag.id, startIndex: index, rowHeight, toIndex: index })
  }

  function onHandlePointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const move = moveDrag(dragRef, event)
    if (move === null) return
    const steps = Math.round(move.dy / move.data.rowHeight)
    const toIndex = clamp(move.data.startIndex + steps, 0, relevanceTags.length - 1)
    move.data.toIndex = toIndex
    setDragPreview({ id: move.data.id, toIndex })
  }

  function onHandlePointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return
    const end = commitDrag(dragRef, event)
    if (end === null) return
    setDragPreview(null)
    if (end.moved) {
      dispatch({ kind: 'relevance-tag/reordered', tagId: end.data.id, toIndex: end.data.toIndex })
    }
  }

  /**
   * The platform withdrew the gesture, so the list snaps back to the document's own order and
   * nothing is dispatched — a cancel is not a shorter pointerup. Escape mid-drag is the same
   * terminal: there is no pointer event for a key press, so it clears the ref by hand rather
   * than through `drag-gesture.ts`'s own cancel path.
   */
  function onHandlePointerCancel(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (cancelDrag(dragRef, event)) setDragPreview(null)
  }

  const dragging = dragPreview !== null
  useEffect(() => {
    if (!dragging) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      dragRef.current = null
      setDragPreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dragging])

  // The order this list actually renders in: the document's own, with the dragged tag at its
  // live target position. Identical to `relevanceTags` whenever no drag is in flight.
  const orderedTags = useMemo(() => {
    if (dragPreview === null) return relevanceTags
    const from = relevanceTags.findIndex((tag) => tag.id === dragPreview.id)
    if (from === -1) return relevanceTags
    const next = [...relevanceTags]
    const [moved] = next.splice(from, 1)
    next.splice(dragPreview.toIndex, 0, moved)
    return next
  }, [relevanceTags, dragPreview])

  return (
    <section className="insights__panel relevance-tag-list" aria-label="Relevance tags">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Relevance tags</h2>
        <p className="insights__panel-note">
          The vocabulary every chip, band and chart segment draws from. Delete one and every line
          carrying it simply goes untagged — nothing else about those lines changes.
        </p>
        <button type="button" className="button--primary" onClick={createTag}>
          New tag
        </button>
      </header>

      {relevanceTags.length === 0 ? (
        <p className="insights__empty">No relevance tags left. Add one to start classifying lines.</p>
      ) : (
        <ul className="relevance-tag-list__items">
          {orderedTags.map((tag) => {
            // The tag's real position, not its live preview slot — what the Move buttons and
            // their disabled state must agree with, since a click is never mid-drag.
            const index = relevanceTags.indexOf(tag)
            return (
              <li
                key={tag.id}
                className="relevance-tag-list__item"
                data-dragging={dragPreview?.id === tag.id ? 'true' : undefined}
              >
                <RelevanceTagRow
                  tag={tag}
                  index={index}
                  count={relevanceTags.length}
                  dialogues={dialogues}
                  // Only the row the mode names is in that mode; every other row stays idle.
                  mode={'id' in mode && mode.id === tag.id ? mode : { kind: 'idle' }}
                  onSetMode={setMode}
                  filter={filter}
                  onFilterChange={onFilterChange}
                  onHandlePointerDown={(event) => onHandlePointerDown(event, tag, index)}
                  onHandlePointerMove={onHandlePointerMove}
                  onHandlePointerUp={onHandlePointerUp}
                  onHandlePointerCancel={onHandlePointerCancel}
                  onMove={(toIndex) =>
                    dispatch({ kind: 'relevance-tag/reordered', tagId: tag.id, toIndex })
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Exhaustive over `RelevanceTagListMode`; the `ReactElement` return type rejects a silently added one. */
function RelevanceTagRow({
  tag,
  index,
  count,
  dialogues,
  mode,
  onSetMode,
  filter,
  onFilterChange,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel,
  onMove,
}: {
  tag: RelevanceTag
  /** This tag's position in the document's own order — never the live drag preview. */
  index: number
  /** How many tags there are, so the last row's "Move down" can disable itself. */
  count: number
  dialogues: readonly Dialogue[]
  mode: RelevanceTagListMode
  onSetMode: (mode: RelevanceTagListMode) => void
  filter: DialogueFilter
  onFilterChange: (filter: DialogueFilter) => void
  onHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMove: (toIndex: number) => void
}): ReactElement {
  const triggerRef = useRowFocus(triggerOf(mode))

  switch (mode.kind) {
    case 'renaming':
      return <RelevanceTagRenameForm tag={tag} onDone={() => onSetMode({ kind: 'idle' })} />

    // The swatches carry the raw hue: a relevance tag has no status that overrides its colour,
    // unlike a quest's, so there is nothing else the palette would need to show instead.
    case 'recolouring':
      return (
        <div className="relevance-tag-list__palette" role="group" aria-label={`Colour of ${tagLabel(tag)}`}>
          {RELEVANCE_HUES.map((hue) => (
            <button
              key={hue}
              type="button"
              className="relevance-tag-list__swatch"
              style={relevanceHueStyle(hue)}
              aria-label={`Hue ${hue}`}
              aria-pressed={hue === tag.hue}
              onClick={() => {
                dispatch({ kind: 'relevance-tag/hue-set', tagId: tag.id, hue })
                onSetMode({ kind: 'idle' })
              }}
            />
          ))}
          <button type="button" className="button" onClick={() => onSetMode({ kind: 'idle' })}>
            Cancel
          </button>
        </div>
      )

    case 'confirming-delete': {
      const count = dialogues.filter((dialogue) => dialogue.relevance.includes(tag.id)).length
      return (
        <div className="relevance-tag-list__confirm" role="alert">
          <span>
            Delete <strong>{tagLabel(tag)}</strong>? {describeCascade(count)}
          </span>
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              dispatch({ kind: 'relevance-tag/deleted', tagId: tag.id })
              // A filter naming this tag would otherwise match nothing and offer no chip to
              // switch off — an insights screen stuck empty with no visible cause.
              if (filter.relevance.includes(tag.id)) {
                onFilterChange({
                  ...filter,
                  relevance: filter.relevance.filter((id) => id !== tag.id),
                })
              }
              onSetMode({ kind: 'idle' })
            }}
          >
            Delete
          </button>
          <button type="button" className="button" onClick={() => onSetMode({ kind: 'idle' })}>
            Cancel
          </button>
        </div>
      )
    }

    case 'idle':
      return (
        <>
          {/* Pointer-only: a keyboard user reorders with the Move buttons below instead, which
              is why this carries no keydown handling of its own. */}
          <button
            type="button"
            className="relevance-tag-list__handle"
            aria-label={`Reorder ${tagLabel(tag)}`}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
          >
            ⠿
          </button>
          <span className="hue-chip relevance-tag-list__name" style={relevanceHueStyle(tag.hue)}>
            {tagLabel(tag)}
          </span>
          <button
            type="button"
            className="button"
            aria-label={`Move ${tagLabel(tag)} up`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            Move up
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Move ${tagLabel(tag)} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            Move down
          </button>
          <button
            ref={triggerRef.rename}
            type="button"
            className="button"
            aria-label={`Rename ${tagLabel(tag)}`}
            onClick={() => onSetMode({ kind: 'renaming', id: tag.id })}
          >
            Rename
          </button>
          <button
            ref={triggerRef.colour}
            type="button"
            className="button"
            aria-label={`Change the colour of ${tagLabel(tag)}`}
            onClick={() => onSetMode({ kind: 'recolouring', id: tag.id })}
          >
            Colour
          </button>
          <button
            ref={triggerRef.delete}
            type="button"
            className="button"
            aria-label={`Delete ${tagLabel(tag)}`}
            onClick={() => onSetMode({ kind: 'confirming-delete', id: tag.id })}
          >
            Delete
          </button>
        </>
      )

    default:
      return assertNever(mode)
  }
}

/**
 * Its own component, not inline JSX in the row: the row's own subtree is swapped whole per
 * mode, and mounting/unmounting *this* component is what commits a draft still in flight when
 * renaming closes — see `useFieldDraft`. Modelled on `QuestForm`, for the same reason: a
 * dispatch per keystroke would copy `relevanceTags`, and that identity is what `PinLayer`'s hue
 * map is built from.
 */
function RelevanceTagRenameForm({ tag, onDone }: { tag: RelevanceTag; onDone: () => void }): ReactElement {
  const tagId = tag.id
  const nameDraft = useFieldDraft(tag.name, (name) =>
    dispatch({ kind: 'relevance-tag/renamed', tagId, name }),
  )

  return (
    <form
      className="relevance-tag-list__form"
      onSubmit={(event) => {
        event.preventDefault()
        onDone()
      }}
    >
      <input
        className="relevance-tag-list__input"
        value={nameDraft.value}
        autoFocus
        aria-label="Relevance tag name"
        onChange={(event) => nameDraft.onChange(event.target.value)}
        onBlur={nameDraft.flush}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone()
        }}
      />
      <button type="submit" className="button">
        Save
      </button>
    </form>
  )
}

/** Which button opened the mode this row is in — exhaustive, so a new mode must name one. */
function triggerOf(mode: RelevanceTagListMode): RowTrigger | null {
  switch (mode.kind) {
    case 'idle':
      return null
    case 'renaming':
      return 'rename'
    case 'recolouring':
      return 'colour'
    case 'confirming-delete':
      return 'delete'
    default:
      return assertNever(mode)
  }
}

/** A tag created but not yet named is nothing to click on — same fallback `questName` gives. */
function tagLabel(tag: RelevanceTag): string {
  const trimmed = tag.name.trim()
  return trimmed === '' ? 'Untitled tag' : trimmed
}

function describeCascade(count: number): string {
  if (count === 0) return 'No line carries it.'
  return count === 1 ? '1 line loses this tag.' : `${count} lines lose this tag.`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditableRowDeleteConfirm, EditableRowRenameForm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { RowActions } from '../app/RowActions.tsx'
import { RELEVANCE_HUES, nextRelevanceHue, relevanceHueStyle } from '../dialogue/relevance.ts'
import type { DragGesture } from '../map/drag-gesture.ts'
import { beginDrag, cancelDrag, commitDrag, moveDrag } from '../map/drag-gesture.ts'
import { useRowFocus } from '../map/row-focus.ts'
import { newRelevanceTagId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, RelevanceTag, RelevanceTagId } from '../project/types.ts'

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
 * The relevance vocabulary, as a list a user edits — mounted on the settings screen (#90), since
 * editing the vocabulary is the project telling the app what words it uses, not a reading of the
 * vocabulary the way the filter chips and the breakdown panel on insights are.
 */
export function RelevanceTagList({
  relevanceTags,
  dialogues,
}: {
  relevanceTags: readonly RelevanceTag[]
  dialogues: readonly Dialogue[]
}): ReactElement {
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
    // Straight into renaming (below, `RelevanceTagRow` opens on an empty name): a nameless tag
    // in a list is nothing to click on.
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
        <p className="insights__panel-note hint-text">
          The vocabulary every chip, band and chart segment draws from. Delete one and every line
          carrying it simply goes untagged — nothing else about those lines changes.
        </p>
        <button type="button" className="button--primary" onClick={createTag}>
          New tag
        </button>
      </header>

      {relevanceTags.length === 0 ? (
        <p className="insights__empty hint-text">No relevance tags left. Add one to start classifying lines.</p>
      ) : (
        <ul className="relevance-tag-list__items">
          {orderedTags.map((tag) => {
            // The tag's real position, not its live preview slot — what the Move buttons and
            // their disabled state must agree with, since a click is never mid-drag.
            const index = relevanceTags.indexOf(tag)
            return (
              <li
                key={tag.id}
                className="relevance-tag-list__item row-actions-host"
                data-dragging={dragPreview?.id === tag.id ? 'true' : undefined}
              >
                <RelevanceTagRow
                  tag={tag}
                  index={index}
                  count={relevanceTags.length}
                  dialogues={dialogues}
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

/**
 * One tag's row — rename and delete are both `EditableRow`'s. Colour is not: it is its own,
 * untouched third mode (see the issue's non-goals), tracked locally beside `EditableRow`'s own
 * state rather than folded into it.
 */
function RelevanceTagRow({
  tag,
  index,
  count,
  dialogues,
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
  onHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMove: (toIndex: number) => void
}): ReactElement {
  // A tag created nameless (see `createTag`) opens straight into renaming — a blank tag in a
  // list is nothing to click on. Seeded only on the first render, exactly like `useState`'s own
  // lazy initializer: `relevance-tag/renamed` never commits an empty trimmed name, so an
  // existing tag can never re-acquire a blank one later and re-trigger this.
  const editable = useEditableRow(tag.name === '' ? 'rename' : 'idle')
  const [colouring, setColouring] = useState(false)
  const triggerRef = useRowFocus(colouring ? 'colour' : editable.mode === 'idle' ? null : editable.mode)

  if (editable.mode === 'rename') {
    return (
      <EditableRowRenameForm
        value={tag.name}
        label="Relevance tag name"
        onCommit={(name) => {
          const trimmed = name.trim()
          if (trimmed !== '') dispatch({ kind: 'relevance-tag/renamed', tagId: tag.id, name: trimmed })
        }}
        close={editable.close}
      />
    )
  }

  if (editable.mode === 'delete') {
    const cascadeCount = dialogues.filter((dialogue) => dialogue.relevance.includes(tag.id)).length
    return (
      <EditableRowDeleteConfirm
        message={
          <>
            Delete <strong>{tagLabel(tag)}</strong>? {describeCascade(cascadeCount)}
          </>
        }
        onConfirm={() => dispatch({ kind: 'relevance-tag/deleted', tagId: tag.id })}
        close={editable.close}
      />
    )
  }

  if (colouring) {
    // The swatches carry the raw hue: a relevance tag has no status that overrides its colour,
    // unlike a quest's, so there is nothing else the palette would need to show instead.
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
              setColouring(false)
            }}
          />
        ))}
        <button type="button" className="button" onClick={() => setColouring(false)}>
          Cancel
        </button>
      </div>
    )
  }

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
      <RowActions>
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
          onClick={editable.openRename}
        >
          Rename
        </button>
        <button
          ref={triggerRef.colour}
          type="button"
          className="button"
          aria-label={`Change the colour of ${tagLabel(tag)}`}
          onClick={() => setColouring(true)}
        >
          Colour
        </button>
        <button
          ref={triggerRef.delete}
          type="button"
          className="button"
          aria-label={`Delete ${tagLabel(tag)}`}
          onClick={editable.openDelete}
        >
          Delete
        </button>
      </RowActions>
    </>
  )
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

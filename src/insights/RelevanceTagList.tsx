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

// toIndex is advanced by each move rather than read back from dragPreview at commit time — a
// commit can land in the same tick as the move that produced it, before React re-renders.
type TagDragData = { id: RelevanceTagId; startIndex: number; rowHeight: number; toIndex: number }

type TagDragPreview = { id: RelevanceTagId; toIndex: number }

const DEFAULT_ROW_HEIGHT = 32

export function RelevanceTagList({
  relevanceTags,
  dialogues,
}: {
  relevanceTags: readonly RelevanceTag[]
  dialogues: readonly Dialogue[]
}): ReactElement {
  // Bookkeeping lives in a ref, as in PinLayer — only the live preview is state, so a
  // pointermove costs a re-render of this list and nothing else.
  const dragRef = useRef<DragGesture<TagDragData> | null>(null)
  const [dragPreview, setDragPreview] = useState<TagDragPreview | null>(null)

  function createTag(): void {
    const tag: RelevanceTag = {
      id: newRelevanceTagId(),
      name: '',
      hue: nextRelevanceHue(relevanceTags),
    }
    dispatch({ kind: 'relevance-tag/added', tag })
    // RelevanceTagRow opens straight into renaming when a tag's name is empty.
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

  // A cancel is not a shorter pointerup — nothing is dispatched and the list snaps back.
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
            // Real position, not the live preview slot, since a click is never mid-drag.
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

// Colour is its own mode, tracked locally beside EditableRow's rename/delete state.
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
  index: number
  count: number
  dialogues: readonly Dialogue[]
  onHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandlePointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMove: (toIndex: number) => void
}): ReactElement {
  // Seeded only on the first render, like useState's lazy initializer — relevance-tag/renamed
  // never commits an empty trimmed name, so an existing tag can't re-acquire a blank one later.
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
    return (
      <div className="relevance-tag-list__palette" role="group" aria-label={`Colour of ${tagLabel(tag)}`}>
        {RELEVANCE_HUES.map((hue) => (
          <button
            key={hue}
            type="button"
            className="hue-swatch relevance-tag-list__swatch"
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
      {/* Pointer-only — a keyboard user reorders with the Move buttons below instead. */}
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

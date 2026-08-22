import type { ReactElement } from 'react'
import { useState } from 'react'
import { assertNever } from '../assert-never.ts'
import { RELEVANCE_HUES, nextRelevanceHue, relevanceHueStyle } from '../dialogue/relevance.ts'
import type { RowTrigger } from '../map/row-focus.ts'
import { useRowFocus } from '../map/row-focus.ts'
import { newRelevanceTagId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, RelevanceTag, RelevanceTagId } from '../project/types.ts'
import { useFieldDraft } from '../use-field-draft.ts'
import type { DialogueFilter } from './filters.ts'

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
          {relevanceTags.map((tag) => (
            <li key={tag.id} className="relevance-tag-list__item">
              <RelevanceTagRow
                tag={tag}
                dialogues={dialogues}
                // Only the row the mode names is in that mode; every other row stays idle.
                mode={'id' in mode && mode.id === tag.id ? mode : { kind: 'idle' }}
                onSetMode={setMode}
                filter={filter}
                onFilterChange={onFilterChange}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Exhaustive over `RelevanceTagListMode`; the `ReactElement` return type rejects a silently added one. */
function RelevanceTagRow({
  tag,
  dialogues,
  mode,
  onSetMode,
  filter,
  onFilterChange,
}: {
  tag: RelevanceTag
  dialogues: readonly Dialogue[]
  mode: RelevanceTagListMode
  onSetMode: (mode: RelevanceTagListMode) => void
  filter: DialogueFilter
  onFilterChange: (filter: DialogueFilter) => void
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
          <span className="hue-chip relevance-tag-list__name" style={relevanceHueStyle(tag.hue)}>
            {tagLabel(tag)}
          </span>
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

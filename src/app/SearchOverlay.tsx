import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { useState } from 'react'

/**
 * A local-query search list with a close button and Escape handling — DialoguePicker and
 * QuestPicker are this shape exactly. `stopPropagation` runs before `onClose` on Escape, so
 * closing the overlay inside a panel does not also close the panel behind it. Filtering, sorting
 * and how an item renders stay the caller's: `filter` runs on every keystroke, the way each
 * caller's own `useMemo` already did.
 */
export function SearchOverlay<T>({
  className,
  barClassName,
  inputClassName,
  listClassName,
  noteClassName,
  itemClassName,
  placeholder,
  ariaLabel,
  filter,
  itemKey,
  itemStyle,
  renderItem,
  onPick,
  emptyMessage,
  onClose,
  limit,
}: {
  className: string
  barClassName: string
  inputClassName: string
  listClassName: string
  noteClassName: string
  itemClassName: string
  placeholder: string
  ariaLabel: string
  filter: (query: string) => readonly T[]
  itemKey: (item: T) => string
  itemStyle?: (item: T) => CSSProperties
  renderItem: (item: T) => ReactNode
  onPick: (item: T) => void
  /** Shown only when the filtered list is empty. */
  emptyMessage: string
  onClose: () => void
  /** Caps the rendered list; past it a "…and N more" note asks the user to narrow the search. */
  limit?: number
}): ReactElement {
  const [query, setQuery] = useState('')
  const matches = filter(query)
  const shown = limit === undefined ? matches : matches.slice(0, limit)

  return (
    <div
      className={className}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <div className={barClassName}>
        <input
          className={`${inputClassName} text-input`}
          type="search"
          value={query}
          autoFocus
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>

      {shown.length === 0 ? (
        <p className={noteClassName}>{emptyMessage}</p>
      ) : (
        <ul className={listClassName}>
          {shown.map((item) => (
            <li key={itemKey(item)}>
              <button
                type="button"
                className={itemClassName}
                style={itemStyle?.(item)}
                onClick={() => onPick(item)}
              >
                {renderItem(item)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {limit !== undefined && matches.length > limit && (
        <p className={noteClassName}>…and {matches.length - limit} more. Narrow the search.</p>
      )}
    </div>
  )
}

import type { ReactElement } from 'react'
import { useId } from 'react'

/**
 * Platform autocomplete: `<input list>` over a `<datalist>` of the NPC names already in the
 * project. Not a custom combobox — the browser already gives keyboard navigation, filtering,
 * and screen-reader semantics for free, and the input stays a plain text field so a name
 * never seen before is typed straight in.
 *
 * The `<label>` lives with the rest of the form and targets `id`, which is why that is a prop
 * rather than generated here.
 */
export function NpcNameInput({
  id,
  value,
  names,
  onChange,
  onBlur,
  autoFocus,
}: {
  id: string
  value: string
  /** Recently spoken first, then the rest alphabetically — see `npcNamesIn`. */
  names: readonly string[]
  onChange: (value: string) => void
  onBlur: () => void
  /** React's own mount-time focus, not an effect — see `DialogueForm`'s `key`ed remount. */
  autoFocus?: boolean
}): ReactElement {
  const listId = useId()

  return (
    <>
      <input
        id={id}
        className="dialogue-form__input"
        type="text"
        list={listId}
        value={value}
        placeholder="Who said it"
        // The browser's own form history would offer names from other projects — and other
        // sites — alongside this project's, which is exactly the wrong suggestion set.
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <datalist id={listId}>
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  )
}

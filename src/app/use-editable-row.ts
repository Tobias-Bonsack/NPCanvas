import { useCallback, useState } from 'react'

/**
 * The state machine half of `EditableRow.tsx` — split into its own file, not a stylistic
 * choice: `react-refresh/only-export-components` requires a component file to export nothing
 * but components, and this is a hook. Both files together are still the one place either
 * interaction (see `EditableRow.tsx`'s own doc comment) is implemented; nothing outside this
 * pair declares a rename or delete-confirmation mode of its own.
 */
type EditableRowMode = 'idle' | 'rename' | 'delete'

type EditableRowController = {
  mode: EditableRowMode
  openRename: () => void
  openDelete: () => void
  close: () => void
}

/**
 * One row's mode, local to whatever component calls it — never the store, per CLAUDE.md's
 * "Store scope". Call it once per row (a list item, a card, a pin), not once per list: two rows
 * are free to be mid-edit at the same time, which is a relaxation from the single list-wide mode
 * every caller used to hand-roll, and is deliberate — nothing about this component needs one
 * row's edit to close another's.
 *
 * `initialMode` seeds the very first render only, exactly as `useState`'s own lazy initializer
 * does — `RelevanceTagList` uses it to open a freshly created, still-nameless tag straight into
 * renaming, without an effect that would otherwise need `react-hooks/exhaustive-deps` silenced.
 */
export function useEditableRow(initialMode: EditableRowMode = 'idle'): EditableRowController {
  const [mode, setMode] = useState<EditableRowMode>(initialMode)
  return {
    mode,
    openRename: useCallback(() => setMode('rename'), []),
    openDelete: useCallback(() => setMode('delete'), []),
    close: useCallback(() => setMode('idle'), []),
  }
}

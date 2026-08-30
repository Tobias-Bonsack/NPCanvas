import { useCallback, useState } from 'react'

// Split from EditableRow.tsx because react-refresh/only-export-components requires a
// component file to export nothing but components, and this is a hook.
type EditableRowMode = 'idle' | 'rename' | 'delete'

type EditableRowController = {
  mode: EditableRowMode
  openRename: () => void
  openDelete: () => void
  close: () => void
}

// Called once per row, not per list — two rows can be mid-edit at once, deliberately. initialMode
// seeds only the first render, like useState's lazy initializer (RelevanceTagList uses this to
// open a fresh nameless tag straight into renaming).
export function useEditableRow(initialMode: EditableRowMode = 'idle'): EditableRowController {
  const [mode, setMode] = useState<EditableRowMode>(initialMode)
  return {
    mode,
    openRename: useCallback(() => setMode('rename'), []),
    openDelete: useCallback(() => setMode('delete'), []),
    close: useCallback(() => setMode('idle'), []),
  }
}

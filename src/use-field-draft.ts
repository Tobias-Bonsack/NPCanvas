import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A text field the store only hears about when the typing stops.
 *
 * Every keystroke into `dispatch` copies the whole `dialogues` array, and that identity is what
 * `PinLayer`'s `memo` is keyed on — so a character typed into a line used to reconcile every pin
 * on the canvas. CLAUDE.md � "Store scope" already puts form drafts in component `useState`;
 * this is that place, made reusable because four fields need it.
 *
 * The draft is not a second source of truth: it yields to the document whenever the document
 * changes underneath it (a capture appending to the line), and it flushes on blur, after a short
 * idle, and on unmount — which is how closing the panel or switching pins cannot lose it. Forms
 * using this must therefore be keyed on the record they edit, so a switch unmounts rather than
 * re-props: unmount is what flushes to the *old* record before the new one is seeded.
 */
export type FieldDraft = {
  /** What the control shows. Bind it to `value`. */
  value: string
  /** Bind to `onChange`. Arms the idle flush. */
  onChange: (value: string) => void
  /** Bind to `onBlur` — and call before anything that reads the field's value out of the store. */
  flush: () => void
}

// Shorter than autosave's 800 ms debounce, which this sits in front of: the flush only has to
// land inside the window that debounce is already going to wait out.
const IDLE_FLUSH_MS = 300

export function useFieldDraft(committed: string, commit: (value: string) => void): FieldDraft {
  const [draft, setDraft] = useState(committed)
  const [base, setBase] = useState(committed)

  // The document moved under the field — a capture appended to the line, or an NPC was renamed
  // across the project. The draft describes a value that no longer exists, so it yields.
  if (committed !== base) {
    setBase(committed)
    setDraft(committed)
  }

  // The flush identity has to be stable (the unmount effect depends on it), so what it flushes
  // is read from a ref rather than closed over.
  const latest = useRef({ draft, committed, commit })
  useEffect(() => {
    latest.current = { draft, committed, commit }
  })

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const current = latest.current
    if (current.draft !== current.committed) current.commit(current.draft)
  }, [])

  useEffect(() => flush, [flush])

  const onChange = useCallback(
    (value: string) => {
      setDraft(value)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, IDLE_FLUSH_MS)
    },
    [flush],
  )

  return { value: draft, onChange, flush }
}

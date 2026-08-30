import { useCallback, useEffect, useRef, useState } from 'react'

// A text field the store only hears about when typing stops — every keystroke into dispatch
// copies project.dialogues, whose identity PinLayer's memo is keyed on. The draft yields to the
// document whenever it changes underneath it, and flushes on blur, idle, and unmount — so a
// form using this must be keyed on the record it edits (unmount flushes the old record first).
type FieldDraft = {
  value: string
  onChange: (value: string) => void
  // Bind to onBlur — and call before anything reads the field's value out of the store.
  flush: () => void
}

// Shorter than autosave's 800ms debounce, which this sits in front of.
const IDLE_FLUSH_MS = 300

export function useFieldDraft(committed: string, commit: (value: string) => void): FieldDraft {
  const [draft, setDraft] = useState(committed)
  const [base, setBase] = useState(committed)

  // The document moved under the field (a capture appended, an NPC was renamed), so it yields.
  if (committed !== base) {
    setBase(committed)
    setDraft(committed)
  }

  // flush's identity must be stable (the unmount effect depends on it), so it reads from a ref.
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

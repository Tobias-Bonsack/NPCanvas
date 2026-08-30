import type { RefCallback } from 'react'
import { useEffect, useMemo, useRef } from 'react'

// `colour` exists only on a zone row; a row that never renders one simply never registers it.
type RowTrigger = 'rename' | 'colour' | 'delete'

// Restores focus to the button that opened a row's rename/colour/delete mode once it closes —
// a row swaps its entire subtree per mode, so the browser would otherwise drop focus to <body>.
export function useRowFocus(open: RowTrigger | null): Record<RowTrigger, RefCallback<HTMLButtonElement>> {
  const elements = useRef<Partial<Record<RowTrigger, HTMLButtonElement | null>>>({})
  const opened = useRef<RowTrigger | null>(null)

  useEffect(() => {
    if (open !== null) {
      opened.current = open
      return
    }
    const trigger = opened.current
    opened.current = null
    if (trigger !== null) elements.current[trigger]?.focus({ preventScroll: true })
  }, [open])

  // Stable across renders — a fresh callback ref per render would detach/reattach every
  // trigger button on every keystroke of a rename draft.
  return useMemo<Record<RowTrigger, RefCallback<HTMLButtonElement>>>(
    () => ({
      rename: (element) => {
        elements.current.rename = element
      },
      colour: (element) => {
        elements.current.colour = element
      },
      delete: (element) => {
        elements.current.delete = element
      },
    }),
    [],
  )
}

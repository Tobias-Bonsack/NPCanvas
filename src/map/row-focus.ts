import type { RefCallback } from 'react'
import { useEffect, useMemo, useRef } from 'react'

/**
 * The buttons in a sidebar list row that open a mode of their own. `colour` exists only on a
 * zone row; a row that never renders one simply never registers it.
 */
export type RowTrigger = 'rename' | 'colour' | 'delete'

/**
 * Puts focus back on the button that opened a row's rename form, colour palette or delete
 * confirmation once that mode closes.
 *
 * A row swaps its **entire** subtree per mode, so submitting or cancelling unmounts the
 * element that had focus and the browser drops focus to `<body>` — a keyboard user restarts
 * the tab cycle at the top of the document, several rows away from the one they were editing.
 *
 * `open` is the trigger the current mode belongs to, or `null` for idle; the caller maps its
 * own mode union onto it exhaustively, so a mode added later cannot silently lose its trigger.
 */
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
    // `preventScroll` for the same reason the pin focus uses it: focus is being restored on
    // the user's behalf, so it must not also move anything under them.
    if (trigger !== null) elements.current[trigger]?.focus({ preventScroll: true })
  }, [open])

  // Stable across renders: a fresh callback ref per render would make React detach and
  // reattach every trigger button on every keystroke of a rename draft.
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

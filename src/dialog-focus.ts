import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Everything an `alertdialog` needs that `role="alert"` alone does not: focus moves onto it the
 * moment it mounts, Tab is trapped inside it for as long as it stays mounted, Escape cancels
 * before the key can reach anything else, and focus returns to whatever opened it on unmount.
 *
 * Bound to the component's own mount/unmount rather than an `active` flag: every caller here is
 * already conditionally rendered (`{confirmingDelete && <...>}`, a `switch` case), so mounting
 * *is* opening and unmounting *is* closing. The listener is attached to `document` in the
 * capture phase — before the event can reach a bubble-phase listener on `window` such as
 * `DialoguePanel`'s own Escape-to-close — which is what makes an open confirmation the one
 * thing Escape can mean while it is up.
 */
export function useAlertDialogFocus(onCancel: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  // Kept fresh without re-running the effect below on every render: the effect's cleanup must
  // restore focus exactly once, on unmount, so its dependency list stays empty.
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  })

  useEffect(() => {
    const trigger = document.activeElement
    const container = ref.current
    const initial = container === null ? [] : focusableIn(container)
    ;(initial[0] ?? container)?.focus()

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || container === null) return
      const items = focusableIn(container)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (trigger instanceof HTMLElement) trigger.focus()
    }
  }, [])

  return ref
}

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

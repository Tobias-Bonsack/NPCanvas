/**
 * Whether the user is typing somewhere — the guard every keyboard shortcut this app adds to
 * the canvas honours, so a single-letter tool shortcut or an arrow-key pan cannot fire while
 * it is being typed into a dialogue's line, an NPC name, or a sidebar rename field. Shared
 * between `MapCanvas` (its own pan/zoom/nudge shortcuts) and `MapScreen` (the global
 * tool-switch listener) rather than duplicated, so the two cannot drift on what counts as a
 * text field. `isContentEditable` covers nothing in this codebase today, but costs nothing to
 * guard against.
 */
export function isTextFieldFocused(): boolean {
  const active = document.activeElement
  if (active === null) return false
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true
  return active instanceof HTMLElement && active.isContentEditable
}

/**
 * Whether the user is typing somewhere — the guard every global keyboard shortcut this app adds
 * honours, so a single-letter tool shortcut, an arrow-key pan, or the search palette's `/` cannot
 * fire while it is being typed into a dialogue's line, an NPC name, or a sidebar rename field.
 * Shared across every global listener (`MapCanvas`'s own pan/zoom/nudge shortcuts, `MapScreen`'s
 * tool-switch listener, `SearchPalette`'s open shortcut) rather than duplicated, so none of them
 * can drift on what counts as a text field. `isContentEditable` covers nothing in this codebase
 * today, but costs nothing to guard against.
 */
export function isTextFieldFocused(): boolean {
  const active = document.activeElement
  if (active === null) return false
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true
  return active instanceof HTMLElement && active.isContentEditable
}

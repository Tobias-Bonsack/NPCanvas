import type { ReactElement } from 'react'
import { useEffect, useMemo } from 'react'
import type { Dialogue, ProjectFile } from '../project/types.ts'
import { DialogueForm } from './DialogueForm.tsx'

/**
 * The detail view for the selected dialogue. Rendering it at all *is* "open" — the parent
 * owns the selection, so closing on deselect needs no state here.
 *
 * A sibling panel rather than an overlay on the canvas: the map stays visible and pannable
 * while a line is being written, which is the whole point of logging dialogue in place.
 */
export function DialoguePanel({
  project,
  dialogue,
  onClose,
}: {
  project: ProjectFile
  dialogue: Dialogue
  /** Must be stable — the Escape listener below depends on it. */
  onClose: () => void
}): ReactElement {
  // Bound on `window`, not on the panel: the selected pin keeps focus after a click, and an
  // Escape aimed at "close this" would otherwise have to be pressed inside the panel first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const npcNames = useMemo(() => npcNamesIn(project.dialogues), [project.dialogues])
  const map = project.maps.find((candidate) => candidate.id === dialogue.mapId) ?? null

  return (
    <aside className="dialogue-panel" aria-label="Dialogue">
      <header className="dialogue-panel__header">
        <h2 className="dialogue-panel__title">Dialogue</h2>
        <button type="button" className="dialogue-panel__close" onClick={onClose}>
          Close
        </button>
      </header>
      {/* The map association is not editable — a dialogue belongs to the map it was pinned
          onto, and moving it between maps would strand its map-local position. */}
      <p className="dialogue-panel__map">on {map === null ? 'an unknown map' : map.name}</p>
      <DialogueForm dialogue={dialogue} npcNames={npcNames} />
    </aside>
  )
}

/** Every NPC name in the project, deduplicated, blanks dropped, in locale order. */
function npcNamesIn(dialogues: readonly Dialogue[]): string[] {
  const names = new Set<string>()
  for (const dialogue of dialogues) {
    const trimmed = dialogue.npcName.trim()
    if (trimmed !== '') names.add(trimmed)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

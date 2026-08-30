import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { subsetByTimeDesc } from '../dialogue/dialogue-order.ts'
import { dialogueSearchTexts } from '../project/derived.ts'
import type { Dialogue, DialogueId, Zone, ZoneId } from '../project/types.ts'
import { DialogueRowContent } from './DialogueRow.tsx'
import { resolveZones } from './dialogue-summary.ts'
import './DialoguePicker.css'

const PICKER_LIMIT = 25

// Empty query lists everything unattached, newest first — the line just logged is the one
// most likely being picked. Used by the quest board's attach picker.
export function DialoguePicker({
  dialogues,
  exclude,
  zonesById,
  zoneIndex,
  emptyMessage,
  onPick,
  onClose,
}: {
  dialogues: readonly Dialogue[]
  exclude: readonly DialogueId[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  /** Shown only when every dialogue in the project is already excluded. */
  emptyMessage: string
  onPick: (id: DialogueId) => void
  onClose: () => void
}): ReactElement {
  const [query, setQuery] = useState('')

  const excluded = useMemo(() => new Set(exclude), [exclude])
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const searchTexts = dialogueSearchTexts(dialogues)
    const candidates = dialogues.filter((dialogue) => !excluded.has(dialogue.id))
    const hits =
      needle === ''
        ? candidates
        : candidates.filter((dialogue) => (searchTexts.get(dialogue.id) ?? '').includes(needle))
    return subsetByTimeDesc(hits, dialogues)
  }, [dialogues, excluded, query])

  return (
    // stopPropagation so Escape closes only this picker, not a panel's own window-bound
    // Escape-to-close listener too.
    <div
      className="dialogue-picker"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="dialogue-picker__bar">
        <input
          className="dialogue-picker__input text-input"
          type="search"
          value={query}
          autoFocus
          placeholder="Search by NPC or what was said"
          aria-label="Search dialogues"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>

      {matches.length === 0 ? (
        <p className="dialogue-picker__empty hint-text">
          {dialogues.length === excluded.size ? emptyMessage : 'No dialogue matches that.'}
        </p>
      ) : (
        <ul className="dialogue-picker__list">
          {matches.slice(0, PICKER_LIMIT).map((dialogue) => (
            <li key={dialogue.id}>
              <button type="button" className="dialogue-row" onClick={() => onPick(dialogue.id)}>
                <DialogueRowContent
                  dialogue={dialogue}
                  zones={resolveZones(dialogue.id, zoneIndex, zonesById)}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {matches.length > PICKER_LIMIT && (
        <p className="dialogue-picker__more hint-text">
          …and {matches.length - PICKER_LIMIT} more. Narrow the search.
        </p>
      )}
    </div>
  )
}

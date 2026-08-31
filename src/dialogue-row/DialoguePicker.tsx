import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { SearchOverlay } from '../app/SearchOverlay.tsx'
import { subsetByTimeDesc } from '../dialogue/dialogue-order.ts'
import { dialogueSearchTexts } from '../project/derived.ts'
import type { Dialogue, DialogueId, Zone, ZoneId } from '../project/types.ts'
import { DialogueRowContent } from './DialogueRow.tsx'
import { resolveZones } from './dialogue-summary.ts'
import './dialogue-row.css'

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
  const excluded = useMemo(() => new Set(exclude), [exclude])

  function filter(query: string): Dialogue[] {
    const needle = query.trim().toLowerCase()
    const searchTexts = dialogueSearchTexts(dialogues)
    const candidates = dialogues.filter((dialogue) => !excluded.has(dialogue.id))
    const hits =
      needle === ''
        ? candidates
        : candidates.filter((dialogue) => (searchTexts.get(dialogue.id) ?? '').includes(needle))
    return subsetByTimeDesc(hits, dialogues)
  }

  return (
    <SearchOverlay
      className="dialogue-picker"
      barClassName="dialogue-picker__bar"
      inputClassName="dialogue-picker__input"
      listClassName="dialogue-picker__list"
      noteClassName="dialogue-picker__empty hint-text"
      itemClassName="dialogue-row"
      placeholder="Search by NPC or what was said"
      ariaLabel="Search dialogues"
      filter={filter}
      itemKey={(dialogue) => dialogue.id}
      renderItem={(dialogue) => (
        <DialogueRowContent
          dialogue={dialogue}
          zones={resolveZones(dialogue.id, zoneIndex, zonesById)}
        />
      )}
      onPick={(dialogue) => onPick(dialogue.id)}
      emptyMessage={dialogues.length === excluded.size ? emptyMessage : 'No dialogue matches that.'}
      onClose={onClose}
      limit={PICKER_LIMIT}
    />
  )
}

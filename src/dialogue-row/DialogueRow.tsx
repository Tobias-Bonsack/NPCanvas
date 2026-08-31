import type { ReactElement } from 'react'
import { formatRoute } from '../app/route.ts'
import { ContentGlyph } from '../dialogue/ContentGlyph.tsx'
import { npcKey, npcLabel } from '../insights/filters.ts'
import { ZoneChips } from '../insights/ZoneChips.tsx'
import type { Dialogue, Zone } from '../project/types.ts'
import { dialogueContentKind } from '../project/types.ts'
import { dialogueSnippet, formatSpokenAt } from './dialogue-summary.ts'
import './dialogue-row.css'

/**
 * One dialogue's identity — glyph, NPC, snippet, zones, timestamp — laid out in the one grid
 * every list of dialogues in the app uses: the timeline's hover detail, the NPC dossier, the
 * quest board's linked lines and its attach picker. Shared so `dialogueSnippet`/`formatSpokenAt`
 * and the row's own CSS grid exist exactly once, not once per feature that lists dialogues.
 *
 * Exported separately from `DialogueRow` because not every caller wants an `<a>`: the quest
 * board's attach picker renders this inside a `<button>` that *picks* a dialogue rather than
 * navigating to it.
 */
export function DialogueRowContent({
  dialogue,
  zones,
}: {
  dialogue: Dialogue
  zones: readonly Zone[]
}): ReactElement {
  return (
    <>
      <ContentGlyph kind={dialogueContentKind(dialogue)} />
      <span className="dialogue-row__npc">{npcLabel(npcKey(dialogue))}</span>
      <span className="dialogue-row__snippet">{dialogueSnippet(dialogue)}</span>
      <span className="dialogue-row__where">
        <ZoneChips zones={zones} nowhereClassName="dialogue-row__nowhere" />
      </span>
      <time className="dialogue-row__when" dateTime={dialogue.spokenAt}>
        {formatSpokenAt(dialogue.spokenAt)}
      </time>
    </>
  )
}

/**
 * `DialogueRowContent` as a link back to the dialogue's pin. An anchor rather than a button:
 * the hash *is* the navigation mechanism, so middle-click and bookmarking work with no handler
 * of ours. `focus` carries the map, or a pin on a distant map would be selected off screen.
 */
export function DialogueRow({
  dialogue,
  zones,
}: {
  dialogue: Dialogue
  zones: readonly Zone[]
}): ReactElement {
  return (
    <a
      className="dialogue-row"
      href={formatRoute({
        kind: 'canvas',
        dialogueId: dialogue.id,
        focus: { kind: 'map', id: dialogue.mapId },
      })}
    >
      <DialogueRowContent dialogue={dialogue} zones={zones} />
    </a>
  )
}

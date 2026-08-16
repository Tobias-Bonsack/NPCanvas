import type { ReactElement } from 'react'
import { formatRoute } from '../app/route.ts'
import { ContentGlyph } from '../dialogue/ContentGlyph.tsx'
import { zoneHueStyle } from '../map/zone-style.ts'
import type { Dialogue, Zone } from '../project/types.ts'
import { dialogueContentKind } from '../project/types.ts'
import { dialogueSnippet, formatSpokenAt, zoneLabel } from './dialogue-summary.ts'
import { npcKey, npcLabel } from './filters.ts'

/**
 * One dialogue as a link back to its pin. An anchor rather than a button, like the quest board's
 * rows: the hash *is* the navigation mechanism, so middle-click and bookmarking work with no
 * handler of ours. `focus` carries the map, or a pin on a distant map would be selected off
 * screen.
 *
 * Shared by every insights panel that lists lines, so the timeline's hover detail and the NPC
 * dossier cannot disagree about what identifies a dialogue.
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
      href={formatRoute({ kind: 'canvas', dialogueId: dialogue.id, focusMapId: dialogue.mapId })}
    >
      <ContentGlyph kind={dialogueContentKind(dialogue)} />
      <span className="dialogue-row__npc">{npcLabel(npcKey(dialogue))}</span>
      <span className="dialogue-row__snippet">{dialogueSnippet(dialogue)}</span>
      <span className="dialogue-row__where">
        {zones.length === 0 ? (
          <span className="dialogue-row__nowhere">Outside any zone</span>
        ) : (
          zones.map((zone) => (
            <span key={zone.id} className="dialogue-row__zone" style={zoneHueStyle(zone.hue)}>
              {zoneLabel(zone)}
            </span>
          ))
        )}
      </span>
      <time className="dialogue-row__when" dateTime={dialogue.spokenAt}>
        {formatSpokenAt(dialogue.spokenAt)}
      </time>
    </a>
  )
}

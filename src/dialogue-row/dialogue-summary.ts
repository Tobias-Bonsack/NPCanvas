import type { Dialogue, DialogueId, DialogueMedia, Zone, ZoneId } from '../project/types.ts'

/** The zones a dialogue sits in, most specific first — the order `zone-index.ts` returns. */
export function resolveZones(
  dialogueId: DialogueId,
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
  zonesById: ReadonlyMap<ZoneId, Zone>,
): Zone[] {
  return (zoneIndex.get(dialogueId) ?? []).flatMap((id) => {
    const zone = zonesById.get(id)
    return zone === undefined ? [] : [zone]
  })
}

export function zoneLabel(zone: Zone): string {
  return zone.name.trim() === '' ? 'Unnamed zone' : zone.name
}

/**
 * A `Record`, not a lookup function, so a fifth media kind is a compile error here rather than
 * a row that silently says nothing about its content.
 */
const MEDIA_SNIPPET: Record<DialogueMedia['kind'], string> = {
  image: 'Image',
  gif: 'GIF',
  video: 'Video clip',
}

/**
 * The line if there is one, and what the pictures are otherwise — a dialogue can carry both, and
 * the words are what identifies it in a list.
 *
 * Whitespace is collapsed rather than truncated at a character count: the row is one line with
 * a CSS ellipsis, so the browser cuts it exactly where the column runs out — but a newline would
 * otherwise render as a space of unpredictable width in the middle of it.
 */
export function dialogueSnippet(dialogue: Dialogue): string {
  const collapsed = dialogue.text.replace(/\s+/g, ' ').trim()
  if (collapsed !== '') return collapsed
  if (dialogue.media.length === 0) return 'No text yet'
  return MEDIA_SNIPPET[dialogue.media[0].kind]
}

// Intl rather than a date library — see CLAUDE.md § Dependencies.
const SPOKEN_AT_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** An unparseable instant is shown verbatim: a hand-edited data.json is the user's to fix. */
export function formatSpokenAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : SPOKEN_AT_FORMAT.format(date)
}

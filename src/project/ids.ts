import type { DialogueId, MapId, QuestId, ZoneId } from './types.ts'

// The only permitted `as` casts on ids in the codebase. Every other module must
// obtain ids from here, so a branded id can never be forged from a raw string.

export function newMapId(): MapId {
  return crypto.randomUUID() as MapId
}

export function newZoneId(): ZoneId {
  return crypto.randomUUID() as ZoneId
}

export function newDialogueId(): DialogueId {
  return crypto.randomUUID() as DialogueId
}

export function newQuestId(): QuestId {
  return crypto.randomUUID() as QuestId
}

// Ids arriving from outside the document — the URL hash and `data.json`. Branding a raw
// string is not a claim that the entity exists; callers must still look it up and handle a miss.

export function asMapId(raw: string): MapId {
  return raw as MapId
}

export function asZoneId(raw: string): ZoneId {
  return raw as ZoneId
}

export function asDialogueId(raw: string): DialogueId {
  return raw as DialogueId
}

export function asQuestId(raw: string): QuestId {
  return raw as QuestId
}

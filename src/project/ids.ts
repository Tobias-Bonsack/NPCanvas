import type { DialogueId, MapId, QuestId, ZoneId } from './types'

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

import { dialoguesByTimeAsc } from '../dialogue/dialogue-order.ts'
import { indexDialoguesByZone } from '../map/zone-index.ts'
import { identityCache } from '../project/derived.ts'
import type { Dialogue, ProjectFile, ZoneId } from '../project/types.ts'

/** One line, placed on the reel's own ordinal axis — see CLAUDE.md § "Cinema". */
export type Moment = {
  dialogue: Dialogue
  /** Ordinal position, 0-based — the x axis every Cinema layer is drawn against. */
  index: number
  sessionIndex: number
  /** Real elapsed time since the previous moment; 0 for the first of the whole reel. */
  gapMsBefore: number
  /** Smallest containing zone, derived — never stored; see CLAUDE.md. */
  zoneId: ZoneId | null
  /** How long this line holds the stage at speed 1. */
  dwellMs: number
}

/** A run of moments with no gap between consecutive lines exceeding `SESSION_GAP_MS`. */
export type Session = {
  index: number
  firstMoment: Moment
  lastMoment: Moment
  /** The gap that opened this session; 0 for the reel's first session. */
  gapMsBefore: number
}

export type Reel = {
  moments: Moment[]
  sessions: Session[]
}

// A gap this long reads as "the player put the controller down", not a pause in one sitting.
const SESSION_GAP_MS = 30 * 60_000

// dwellMs constants, declared together so the formula below has nothing spelled inline.
const BASE_MS = 800
const MS_PER_CHAR = 40
const MS_PER_FRAME = 300
const MIN_DWELL_MS = 1500
const MAX_DWELL_MS = 12_000

function dwellFor(dialogue: Dialogue): number {
  const raw = BASE_MS + dialogue.text.length * MS_PER_CHAR + dialogue.media.length * MS_PER_FRAME
  return Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, raw))
}

function buildReelUncached(project: ProjectFile): Reel {
  const ordered = dialoguesByTimeAsc(project.dialogues)
  const zoneIndex = indexDialoguesByZone(project.dialogues, project.zones, project.maps)

  const moments: Moment[] = []
  const sessions: Session[] = []
  let previousAt: number | null = null

  for (const dialogue of ordered) {
    const at = Date.parse(dialogue.spokenAt)
    if (Number.isNaN(at)) continue

    const gapMsBefore = previousAt === null ? 0 : at - previousAt
    previousAt = at

    const startsSession = sessions.length === 0 || gapMsBefore > SESSION_GAP_MS
    const sessionIndex = startsSession ? sessions.length : sessions.length - 1

    const moment: Moment = {
      dialogue,
      index: moments.length,
      sessionIndex,
      gapMsBefore,
      zoneId: (zoneIndex.get(dialogue.id) ?? [])[0] ?? null,
      dwellMs: dwellFor(dialogue),
    }
    moments.push(moment)

    if (startsSession) {
      sessions.push({ index: sessionIndex, firstMoment: moment, lastMoment: moment, gapMsBefore })
    } else {
      sessions[sessionIndex] = { ...sessions[sessionIndex], lastMoment: moment }
    }
  }

  return { moments, sessions }
}

/** Pure over the document; cached on `project`'s own identity — see CLAUDE.md § "Store scope". */
export const buildReel = identityCache(buildReelUncached)

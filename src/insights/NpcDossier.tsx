import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { formatRoute } from '../app/route.ts'
import { MediaView } from '../media/MediaView.tsx'
import { zoneHueStyle } from '../map/zone-style.ts'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, DialogueId, Quest, Zone, ZoneId } from '../project/types.ts'
import { SegmentDefs, SegmentLegend } from './SegmentLegend.tsx'
import { formatSpokenAt, resolveZones, zoneLabel } from './dialogue-summary.ts'
import { npcKey, npcLabel } from './filters.ts'
import type { SegmentKey, Tally } from './relevance-segments.ts'
import {
  SEGMENT_COLOR,
  SEGMENT_KEYS,
  SEGMENT_LABEL,
  emptyTally,
  tally,
  totalOf,
} from './relevance-segments.ts'

/** Everything one NPC's lines add up to, derived on every read — nothing here is stored. */
type NpcProfile = {
  /** The trimmed name, `''` for the unnamed group. Also what a rename matches on. */
  key: string
  label: string
  /** Chronological: a dossier is read as the sequence of what this person said. */
  dialogues: Dialogue[]
  tally: Tally
  zones: Zone[]
  quests: Quest[]
}

/**
 * The collection along the *person* axis: everything one NPC ever said, wherever they said it.
 *
 * Reads the filtered dialogues like every other panel, so a dossier opened under a filter is
 * honestly "what this NPC said, within what you are looking at" rather than a second, quietly
 * different set.
 */
export function NpcDossier({
  dialogues,
  quests,
  zonesById,
  zoneIndex,
}: {
  dialogues: readonly Dialogue[]
  quests: readonly Quest[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
}): ReactElement {
  const profiles = useMemo(
    () => buildProfiles(dialogues, quests, zonesById, zoneIndex),
    [dialogues, quests, zonesById, zoneIndex],
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // A key naming an NPC the filter (or a rename) has since removed falls back to the top of the
  // list rather than leaving the panel blank.
  const selected = profiles.find((profile) => profile.key === selectedKey) ?? profiles[0] ?? null

  return (
    <section className="insights__panel" aria-label="NPC dossier">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Who said it</h2>
        <p className="insights__panel-note">
          NPCs by line count. Renaming one here renames every line they said — and merges them
          into an NPC of that name if one already exists.
        </p>
      </header>

      <SegmentLegend />

      {profiles.length === 0 ? (
        <p className="insights__empty">Nobody has said anything in this selection.</p>
      ) : (
        <div className="npc-dossier">
          <svg className="npc-dossier__defs" aria-hidden="true">
            <SegmentDefs idPrefix="npc" />
          </svg>

          <ul className="npc-dossier__list">
            {profiles.map((profile) => (
              <li key={profile.key}>
                <button
                  type="button"
                  className="npc-dossier__entry"
                  aria-pressed={profile === selected}
                  onClick={() => setSelectedKey(profile.key)}
                >
                  <span className="npc-dossier__name">{profile.label}</span>
                  <span className="npc-dossier__lines">{profile.dialogues.length}</span>
                  <SegmentBar counts={profile.tally.counts} className="npc-dossier__spark" />
                </button>
              </li>
            ))}
          </ul>

          {selected !== null && (
            <Dossier
              // Remounts on selection, which is what resets the rename draft: a half-typed name
              // must never carry over onto a different NPC.
              key={selected.key}
              profile={selected}
              knownKeys={profiles.map((profile) => profile.key)}
              zonesById={zonesById}
              zoneIndex={zoneIndex}
              onRenamed={setSelectedKey}
            />
          )}
        </div>
      )}
    </section>
  )
}

function Dossier({
  profile,
  knownKeys,
  zonesById,
  zoneIndex,
  onRenamed,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  onRenamed: (key: string) => void
}): ReactElement {
  const first = profile.dialogues[0]
  const last = profile.dialogues[profile.dialogues.length - 1]

  return (
    <article className="npc-dossier__detail">
      <RenameForm profile={profile} knownKeys={knownKeys} onRenamed={onRenamed} />

      <dl className="npc-dossier__facts">
        <Fact term="Lines">{profile.dialogues.length}</Fact>
        <Fact term="First seen">{first === undefined ? '—' : formatSpokenAt(first.spokenAt)}</Fact>
        <Fact term="Last seen">{last === undefined ? '—' : formatSpokenAt(last.spokenAt)}</Fact>
      </dl>

      <section className="npc-dossier__section" aria-label="Relevance profile">
        <h4 className="npc-dossier__section-title">Relevance</h4>
        <SegmentBar counts={profile.tally.counts} className="npc-dossier__profile" />
        <ul className="npc-dossier__chips">
          {SEGMENT_KEYS.filter((segment) => profile.tally.counts[segment] > 0).map((segment) => (
            <li key={segment} className="npc-dossier__chip">
              <span
                className="npc-dossier__dot"
                style={{ background: SEGMENT_COLOR[segment] }}
                aria-hidden="true"
              />
              {SEGMENT_LABEL[segment]} {profile.tally.counts[segment]}
            </li>
          ))}
        </ul>
      </section>

      <section className="npc-dossier__section" aria-label="Zones encountered in">
        <h4 className="npc-dossier__section-title">Encountered in</h4>
        {profile.zones.length === 0 ? (
          <p className="insights__empty">Never inside a zone.</p>
        ) : (
          <ul className="npc-dossier__chips">
            {profile.zones.map((zone) => (
              <li key={zone.id} className="dialogue-row__zone" style={zoneHueStyle(zone.hue)}>
                {zoneLabel(zone)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="npc-dossier__section" aria-label="Quests">
        <h4 className="npc-dossier__section-title">Quests</h4>
        {profile.quests.length === 0 ? (
          <p className="insights__empty">None of their lines belong to a quest yet.</p>
        ) : (
          <ul className="npc-dossier__chips">
            {profile.quests.map((quest) => (
              <li key={quest.id}>
                <a
                  className="npc-dossier__quest"
                  style={questAccentStyle(quest)}
                  href={formatRoute({ kind: 'quests', editQuestId: null })}
                >
                  {quest.name.trim() === '' ? 'Untitled quest' : quest.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ol className="npc-dossier__lines">
        {profile.dialogues.map((dialogue) => (
          <li key={dialogue.id}>
            <NpcLine
              dialogue={dialogue}
              label={profile.label}
              zones={resolveZones(dialogue.id, zoneIndex, zonesById)}
            />
          </li>
        ))}
      </ol>
    </article>
  )
}

/**
 * One line in full, rather than the one-row summary the timeline lists: this is the view where
 * the *content* is the point — so the line and every picture of it are shown, not just the first.
 * A dialogue with neither says so, rather than rendering as an empty box.
 */
function NpcLine({
  dialogue,
  label,
  zones,
}: {
  dialogue: Dialogue
  label: string
  zones: readonly Zone[]
}): ReactElement {
  const said = dialogue.text.trim()
  return (
    <article className="npc-line">
      <header className="npc-line__head">
        <time className="dialogue-row__when" dateTime={dialogue.spokenAt}>
          {formatSpokenAt(dialogue.spokenAt)}
        </time>
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
        <a
          className="npc-line__link"
          href={formatRoute({ kind: 'canvas', dialogueId: dialogue.id, focusMapId: dialogue.mapId })}
        >
          Show on canvas
        </a>
      </header>
      {said !== '' && <p className="npc-line__text">{dialogue.text}</p>}
      {dialogue.media.map((medium) => (
        <MediaView key={medium.id} media={medium} label={label} />
      ))}
      {said === '' && dialogue.media.length === 0 && (
        <p className="npc-line__empty">No text yet</p>
      )}
    </article>
  )
}

/**
 * Renaming, as a draft plus an explicit button — deliberately *not* the per-keystroke dispatch
 * `QuestForm` and `DialogueForm` use. Those edit one field of one record; this rewrites every
 * line the NPC ever said, and typing "T" on the way to "Tomas" would merge them into an
 * existing "T" before the second keystroke landed.
 */
function RenameForm({
  profile,
  knownKeys,
  onRenamed,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  onRenamed: (key: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(profile.key)
  const next = draft.trim()
  const merges = next !== profile.key && knownKeys.includes(next)

  return (
    <form
      className="npc-dossier__rename"
      onSubmit={(event) => {
        event.preventDefault()
        if (next === profile.key) return
        dispatch({ kind: 'npc/renamed', from: profile.key, to: next })
        onRenamed(next)
      }}
    >
      <h3 className="npc-dossier__title">{profile.label}</h3>
      <input
        className="filter-bar__search npc-dossier__input"
        value={draft}
        aria-label={`Rename ${profile.label}`}
        placeholder={profile.key === '' ? 'Give them a name' : 'New name'}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="filter-bar__clear" disabled={next === profile.key}>
        {next === '' ? 'Clear name' : 'Rename'}
      </button>
      {merges && (
        <p className="npc-dossier__merge" role="status">
          Merges with the lines already under {npcLabel(next)}.
        </p>
      )}
    </form>
  )
}

function Fact({
  term,
  children,
}: {
  term: string
  children: string | number
}): ReactElement {
  return (
    <div className="npc-dossier__fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** A composition bar: every NPC's is full width, so the shapes compare rather than the sizes. */
function SegmentBar({
  counts,
  className,
}: {
  counts: Record<SegmentKey, number>
  className: string
}): ReactElement {
  const total = totalOf(counts)
  let x = 0

  return (
    <svg className={className} viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      {total === 0 ? (
        <rect width="100" height="8" className="insights__track" />
      ) : (
        SEGMENT_KEYS.map((segment) => {
          const count = counts[segment]
          if (count === 0) return null
          const width = (count / total) * 100
          const left = x
          x += width
          return (
            <g key={segment}>
              <rect x={left} y="0" width={width} height="8" fill={SEGMENT_COLOR[segment]} />
              <rect x={left} y="0" width={width} height="8" fill={`url(#npc-${segment})`} />
            </g>
          )
        })
      )}
    </svg>
  )
}

/**
 * One profile per distinct `npcKey`, sorted by line count. Blank names are a group of their own
 * rather than being dropped: "logged before I knew who was talking" is the state a dossier is
 * for, and it is renamable from there like any other.
 */
function buildProfiles(
  dialogues: readonly Dialogue[],
  quests: readonly Quest[],
  zonesById: ReadonlyMap<ZoneId, Zone>,
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
): NpcProfile[] {
  const questsByDialogue = indexQuestsByDialogue(quests)
  const byKey = new Map<string, Dialogue[]>()
  for (const dialogue of dialogues) {
    const key = npcKey(dialogue)
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [dialogue])
    else bucket.push(dialogue)
  }

  const profiles = [...byKey].map(([key, lines]) => {
    const ordered = [...lines].sort((a, b) => a.spokenAt.localeCompare(b.spokenAt))
    const counts = emptyTally()
    const zones = new Map<ZoneId, Zone>()
    const questSet = new Map<Quest['id'], Quest>()
    for (const dialogue of ordered) {
      tally(counts, dialogue)
      for (const zone of resolveZones(dialogue.id, zoneIndex, zonesById)) zones.set(zone.id, zone)
      for (const quest of questsByDialogue.get(dialogue.id) ?? []) questSet.set(quest.id, quest)
    }
    return {
      key,
      label: npcLabel(key),
      dialogues: ordered,
      tally: counts,
      zones: [...zones.values()],
      quests: [...questSet.values()],
    }
  })

  return profiles.sort(
    (a, b) =>
      b.dialogues.length - a.dialogues.length ||
      // The unnamed group sorts last among equals: it is a to-do, not a character.
      Number(a.key === '') - Number(b.key === '') ||
      a.label.localeCompare(b.label),
  )
}
import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { formatRoute } from '../app/route.ts'
import { RowActions } from '../app/RowActions.tsx'
import { formatSpokenAt, resolveZones, zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { MediaGallery } from '../media/MediaGallery.tsx'
import { zoneHueStyle } from '../map/zone-style.ts'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import { dispatch } from '../project/store.ts'
import { subsetByTimeAsc } from '../dialogue/dialogue-order.ts'
import type {
  Dialogue,
  DialogueId,
  MediaId,
  Quest,
  RelevanceTag,
  Zone,
  ZoneId,
} from '../project/types.ts'
import { SegmentDefs, SegmentLegend } from './SegmentLegend.tsx'
import { npcKey, npcLabel } from './filters.ts'
import type { SegmentKey, Tally } from './relevance-segments.ts'
import {
  emptyTally,
  segmentColor,
  segmentKeys,
  segmentLabel,
  tally,
  totalOf,
} from './relevance-segments.ts'

// Derived on every read — nothing here is stored.
type NpcProfile = {
  key: string
  label: string
  dialogues: Dialogue[]
  tally: Tally
  zones: Zone[]
  quests: Quest[]
}

// Reads the filtered dialogues like every other panel, so a dossier opened under a filter is
// honestly "what this NPC said, within what you're looking at", not a quietly different set.
export function NpcDossier({
  dialogues,
  quests,
  zonesById,
  zoneIndex,
  relevanceTags,
  selectedKey,
  onSelectedKeyChange,
}: {
  dialogues: readonly Dialogue[]
  quests: readonly Quest[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  relevanceTags: readonly RelevanceTag[]
  selectedKey: string | null
  onSelectedKeyChange: (key: string | null) => void
}): ReactElement {
  const profiles = useMemo(
    () => buildProfiles(dialogues, quests, zonesById, zoneIndex, relevanceTags),
    [dialogues, quests, zonesById, zoneIndex, relevanceTags],
  )

  // A key the filter or a rename has since removed falls back to the top of the list.
  const selected = profiles.find((profile) => profile.key === selectedKey) ?? profiles[0] ?? null

  return (
    <section className="insights__panel card" aria-label="NPC dossier">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Who said it</h2>
        <p className="insights__panel-note hint-text">NPCs by line count.</p>
        <Disclosure>
          <p>
            Renaming one here renames every line they said — and merges them into an NPC of that
            name if one already exists.
          </p>
        </Disclosure>
      </header>

      <SegmentLegend tags={relevanceTags} />

      {profiles.length === 0 ? (
        <p className="insights__empty hint-text">Nobody has said anything in this selection.</p>
      ) : (
        <div className="npc-dossier">
          <svg className="npc-dossier__defs" aria-hidden="true">
            <SegmentDefs idPrefix="npc" tags={relevanceTags} />
          </svg>

          <ul className="npc-dossier__list">
            {profiles.map((profile) => (
              <li key={profile.key}>
                <button
                  type="button"
                  className="npc-dossier__entry"
                  aria-pressed={profile === selected}
                  onClick={() => onSelectedKeyChange(profile.key)}
                >
                  <span className="npc-dossier__name">{profile.label}</span>
                  <span className="npc-dossier__count hint-text">{profile.dialogues.length}</span>
                  <SegmentBar
                    counts={profile.tally.counts}
                    tags={relevanceTags}
                    className="npc-dossier__spark"
                  />
                </button>
              </li>
            ))}
          </ul>

          {selected !== null && (
            <Dossier
              // Remounts on selection, resetting the rename draft.
              key={selected.key}
              profile={selected}
              knownKeys={profiles.map((profile) => profile.key)}
              zonesById={zonesById}
              zoneIndex={zoneIndex}
              relevanceTags={relevanceTags}
              onRenamed={onSelectedKeyChange}
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
  relevanceTags,
  onRenamed,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  relevanceTags: readonly RelevanceTag[]
  onRenamed: (key: string) => void
}): ReactElement {
  const first = profile.dialogues[0]
  const last = profile.dialogues[profile.dialogues.length - 1]
  const labels = segmentLabel(relevanceTags)
  const colors = segmentColor(relevanceTags)

  return (
    <article className="npc-dossier__detail">
      <RenameForm profile={profile} knownKeys={knownKeys} onRenamed={onRenamed} />

      <dl className="npc-dossier__facts">
        <Fact term="Lines">{profile.dialogues.length}</Fact>
        <Fact term="First seen">{first === undefined ? '—' : formatSpokenAt(first.spokenAt)}</Fact>
        <Fact term="Last seen">{last === undefined ? '—' : formatSpokenAt(last.spokenAt)}</Fact>
      </dl>

      <section className="npc-dossier__section" aria-label="Relevance profile">
        <h4 className="micro-label">Relevance</h4>
        <SegmentBar
          counts={profile.tally.counts}
          tags={relevanceTags}
          className="npc-dossier__profile"
        />
        <ul className="npc-dossier__chips">
          {segmentKeys(relevanceTags)
            .filter((segment) => (profile.tally.counts.get(segment) ?? 0) > 0)
            .map((segment) => (
              <li key={segment} className="npc-dossier__chip">
                <span
                  className="npc-dossier__dot"
                  style={{ background: colors.get(segment) ?? 'transparent' }}
                  aria-hidden="true"
                />
                {labels.get(segment) ?? ''} {profile.tally.counts.get(segment) ?? 0}
              </li>
            ))}
        </ul>
      </section>

      <section className="npc-dossier__section" aria-label="Zones encountered in">
        <h4 className="micro-label">Encountered in</h4>
        {profile.zones.length === 0 ? (
          <p className="insights__empty hint-text">Never inside a zone.</p>
        ) : (
          <ul className="npc-dossier__chips">
            {profile.zones.map((zone) => (
              <li key={zone.id} className="hue-chip dialogue-row__zone" style={zoneHueStyle(zone.hue)}>
                {zoneLabel(zone)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="npc-dossier__section" aria-label="Quests">
        <h4 className="micro-label">Quests</h4>
        {profile.quests.length === 0 ? (
          <p className="insights__empty hint-text">None of their lines belong to a quest yet.</p>
        ) : (
          <ul className="npc-dossier__chips">
            {profile.quests.map((quest) => (
              <li key={quest.id}>
                <a
                  className="npc-dossier__quest"
                  style={questAccentStyle(quest)}
                  href={formatRoute({ kind: 'quests', editQuestId: quest.id })}
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

function NpcLine({
  dialogue,
  label,
  zones,
}: {
  dialogue: Dialogue
  label: string
  zones: readonly Zone[]
}): ReactElement {
  // Each line pages its own pictures independently — a shared current frame would move all at once.
  const [currentMediaId, setCurrentMediaId] = useState<MediaId | null>(null)
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
              <span key={zone.id} className="hue-chip dialogue-row__zone" style={zoneHueStyle(zone.hue)}>
                {zoneLabel(zone)}
              </span>
            ))
          )}
        </span>
        <a
          className="npc-line__link"
          href={formatRoute({
            kind: 'canvas',
            dialogueId: dialogue.id,
            focus: { kind: 'map', id: dialogue.mapId },
          })}
        >
          Show on canvas
        </a>
      </header>
      {said !== '' && <p className="npc-line__text">{dialogue.text}</p>}
      {/* No reorder/remove here — "Show on canvas" is the way to the panel that can edit media. */}
      <MediaGallery
        media={dialogue.media}
        label={label}
        selectedId={currentMediaId}
        onSelect={setCurrentMediaId}
      />
      {said === '' && dialogue.media.length === 0 && (
        <p className="npc-line__empty hint-text">No text yet</p>
      )}
    </article>
  )
}

// Collapsed until invoked, since renaming rewrites every line the NPC ever said.
function RenameForm({
  profile,
  knownKeys,
  onRenamed,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  onRenamed: (key: string) => void
}): ReactElement {
  const [renaming, setRenaming] = useState(false)

  if (!renaming) {
    return (
      <div className="npc-dossier__rename row-actions-host">
        <h3 className="npc-dossier__title">{profile.label}</h3>
        <RowActions>
          <button type="button" className="button" onClick={() => setRenaming(true)}>
            Rename
          </button>
        </RowActions>
      </div>
    )
  }

  return (
    <RenameFields
      profile={profile}
      knownKeys={knownKeys}
      onDone={(key) => {
        setRenaming(false)
        if (key !== null) onRenamed(key)
      }}
    />
  )
}

// An explicit submit, deliberately not the per-keystroke dispatch QuestForm/DialogueForm use —
// this rewrites every line the NPC said, and typing "T" toward "Tomas" would merge into an
// existing "T" before the second keystroke landed.
function RenameFields({
  profile,
  knownKeys,
  onDone,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  onDone: (key: string | null) => void
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
        onDone(next)
      }}
    >
      <h3 className="npc-dossier__title">{profile.label}</h3>
      <input
        className="text-input npc-dossier__input"
        value={draft}
        autoFocus
        aria-label={`Rename ${profile.label}`}
        placeholder={profile.key === '' ? 'Give them a name' : 'New name'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone(null)
        }}
      />
      <button type="submit" className="button" disabled={next === profile.key}>
        {next === '' ? 'Clear name' : 'Rename'}
      </button>
      <button type="button" className="button" onClick={() => onDone(null)}>
        Cancel
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
      <dt className="micro-label">{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function SegmentBar({
  counts,
  tags,
  className,
}: {
  counts: Map<SegmentKey, number>
  tags: readonly RelevanceTag[]
  className: string
}): ReactElement {
  const total = totalOf(counts)
  const colors = segmentColor(tags)
  let x = 0

  return (
    <svg className={className} viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      {total === 0 ? (
        <rect width="100" height="8" className="insights__track" />
      ) : (
        segmentKeys(tags).map((segment) => {
          const count = counts.get(segment) ?? 0
          if (count === 0) return null
          const width = (count / total) * 100
          const left = x
          x += width
          return (
            <g key={segment}>
              <rect x={left} y="0" width={width} height="8" fill={colors.get(segment) ?? 'transparent'} />
              <rect x={left} y="0" width={width} height="8" fill={`url(#npc-${segment})`} />
            </g>
          )
        })
      )}
    </svg>
  )
}

// Blank names are a group of their own, not dropped — renamable like any other.
function buildProfiles(
  dialogues: readonly Dialogue[],
  quests: readonly Quest[],
  zonesById: ReadonlyMap<ZoneId, Zone>,
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
  relevanceTags: readonly RelevanceTag[],
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
    const ordered = subsetByTimeAsc(lines, dialogues)
    const counts = emptyTally(relevanceTags)
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
      // The unnamed group sorts last among equals.
      Number(a.key === '') - Number(b.key === '') ||
      a.label.localeCompare(b.label),
  )
}
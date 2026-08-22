import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Route } from '../app/route.ts'
import { formatRoute, navigate } from '../app/route.ts'
import type { QuestsViewState } from '../app/view-state.ts'
import { assertNever } from '../assert-never.ts'
import { ContentGlyph } from '../dialogue/ContentGlyph.tsx'
import { indexDialoguesByZone } from '../map/zone-index.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import { newQuestId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import { dialogueSearchText } from '../search/dialogue-search-text.ts'
import type {
  Dialogue,
  DialogueId,
  DialogueMedia,
  ProjectFile,
  Quest,
  QuestId,
  QuestStatus,
  Zone,
  ZoneId,
} from '../project/types.ts'
import { QUEST_STATUSES, dialogueContentKind } from '../project/types.ts'
import { QuestForm } from './QuestForm.tsx'
import { QUEST_HUES, nextQuestHue, questAccentStyle, questHueStyle } from './quest-style.ts'
import './QuestBoard.css'

/**
 * Transient board UI — which card is being edited, which has its picker open, which is
 * confirming a delete. Component state, never the store: see CLAUDE.md § Store scope. One
 * mode for the whole board rather than one per card, because only one card can be mid-edit.
 */
export type QuestBoardMode =
  | { kind: 'idle' }
  | { kind: 'editing'; id: QuestId }
  | { kind: 'recolouring'; id: QuestId }
  | { kind: 'attaching'; id: QuestId }
  | { kind: 'confirming-delete'; id: QuestId }

const STATUS_LABEL: Record<QuestStatus, string> = { open: 'Open', done: 'Done' }

/** The verb that moves a quest to the *other* status — the only transition a card offers. */
const STATUS_TOGGLE: Record<QuestStatus, { to: QuestStatus; label: string }> = {
  open: { to: 'done', label: 'Mark done' },
  done: { to: 'open', label: 'Reopen' },
}

/**
 * The second-priority view. A relevance tag says what *kind* of thing a line was; a quest is
 * the thread the user actually wants to follow and tick off, so quests are made by hand and
 * only ever reference dialogues — deleting one takes nothing with it.
 */
export function QuestBoard({
  project,
  route,
  viewState,
  onViewStateChange,
}: {
  project: ProjectFile
  route: Extract<Route, { kind: 'quests' }>
  viewState: QuestsViewState
  onViewStateChange: (viewState: QuestsViewState) => void
}): ReactElement {
  const { mode } = viewState
  const setMode = useCallback(
    (mode: QuestBoardMode): void => onViewStateChange({ mode }),
    [onViewStateChange],
  )

  // `?edit=<id>` is how the dialogue panel and the dossier open a quest's editor directly, and
  // land the caret in its name field, which lives here. A one-shot intent, so it is cleared with
  // a replacing navigation before the editor opens — left in the hash it would reopen on every
  // render and fight a user who closed it. An id naming a quest that no longer exists is simply
  // dropped. The card is also scrolled into view: an id landing at the top of an unscrolled
  // board with no highlight leaves no indication which quest was meant.
  const editQuestId = route.editQuestId
  const quests = project.quests
  useEffect(() => {
    if (editQuestId === null) return
    navigate({ kind: 'quests', editQuestId: null }, { replace: true })
    if (quests.some((quest) => quest.id === editQuestId)) {
      setMode({ kind: 'editing', id: editQuestId })
      document.getElementById(questCardElementId(editQuestId))?.scrollIntoView({ block: 'center' })
    }
  }, [editQuestId, quests, setMode])

  // Resolved once per document change rather than once per linked row: a quest holds ids, and
  // a card with twenty of them would otherwise scan the dialogue array twenty times.
  const dialoguesById = useMemo(() => byId(project.dialogues), [project.dialogues])
  const zonesById = useMemo(() => byId(project.zones), [project.zones])
  // Locations are derived here exactly as the canvas derives them — a Dialogue stores no zone.
  const zoneIndex = useMemo(
    () => indexDialoguesByZone(project.dialogues, project.zones),
    [project.dialogues, project.zones],
  )

  function createQuest(): void {
    const quest: Quest = {
      id: newQuestId(),
      name: '',
      status: 'open',
      dialogueIds: [],
      note: '',
      hue: nextQuestHue(project.quests),
    }
    dispatch({ kind: 'quest/added', quest })
    // Straight into the editor: a nameless quest in a list is nothing to click on.
    setMode({ kind: 'editing', id: quest.id })
  }

  return (
    <section className="quest-board">
      <header className="quest-board__bar">
        <h1 className="quest-board__title">Quest board</h1>
        <button type="button" className="quest-board__new" onClick={createQuest}>
          New quest
        </button>
      </header>

      {project.quests.length === 0 ? (
        <p className="quest-board__empty">
          No quests yet. A quest is a thread you are following — a rumour, a debt, a name that
          keeps coming up. Start one, then attach the lines that belong to it.
        </p>
      ) : (
        QUEST_STATUSES.map((status) => (
          <QuestGroup
            key={status}
            status={status}
            quests={project.quests.filter((quest) => quest.status === status)}
            dialogues={project.dialogues}
            dialoguesById={dialoguesById}
            zonesById={zonesById}
            zoneIndex={zoneIndex}
            mode={mode}
            onSetMode={setMode}
          />
        ))
      )}
    </section>
  )
}

type BoardData = {
  /** Every dialogue in the project — the pool the attach picker searches. */
  dialogues: readonly Dialogue[]
  dialoguesById: ReadonlyMap<DialogueId, Dialogue>
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
}

/** Renders its heading even when empty: "Done 0" is the progress the board exists to show. */
function QuestGroup({
  status,
  quests,
  mode,
  onSetMode,
  ...data
}: BoardData & {
  status: QuestStatus
  quests: readonly Quest[]
  mode: QuestBoardMode
  onSetMode: (mode: QuestBoardMode) => void
}): ReactElement {
  return (
    <section className="quest-board__group" aria-label={`${STATUS_LABEL[status]} quests`}>
      <h2 className="quest-board__group-heading">
        {STATUS_LABEL[status]}
        <span className="quest-board__count">{quests.length}</span>
      </h2>
      {quests.length === 0 ? (
        <p className="quest-board__group-empty">Nothing here.</p>
      ) : (
        <ul className="quest-board__list">
          {quests.map((quest) => (
            <li key={quest.id}>
              <QuestCard
                quest={quest}
                // Only the card the mode names is in that mode; every other card is idle.
                mode={'id' in mode && mode.id === quest.id ? mode : { kind: 'idle' }}
                onSetMode={onSetMode}
                {...data}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function QuestCard({
  quest,
  mode,
  onSetMode,
  dialogues,
  dialoguesById,
  zonesById,
  zoneIndex,
}: BoardData & {
  quest: Quest
  mode: QuestBoardMode
  onSetMode: (mode: QuestBoardMode) => void
}): ReactElement {
  // Chronological, because a quest is read as a sequence of what was heard when. ISO 8601
  // sorts lexicographically, so no Date is constructed per comparison.
  const linked = useMemo(() => {
    const found = quest.dialogueIds.flatMap((id) => {
      const dialogue = dialoguesById.get(id)
      return dialogue === undefined ? [] : [dialogue]
    })
    return found.sort((a, b) => a.spokenAt.localeCompare(b.spokenAt))
  }, [quest.dialogueIds, dialoguesById])

  const toggle = STATUS_TOGGLE[quest.status]

  return (
    <article
      id={questCardElementId(quest.id)}
      className="quest-card"
      data-status={quest.status}
      style={questAccentStyle(quest)}
    >
      <header className="quest-card__header">
        <h3 className="quest-card__name">{quest.name.trim() === '' ? 'Untitled quest' : quest.name}</h3>
        <span className="quest-card__linked-count">
          {quest.dialogueIds.length} {quest.dialogueIds.length === 1 ? 'dialogue' : 'dialogues'}
        </span>
        <button
          type="button"
          className="quest-board__button"
          onClick={() => dispatch({ kind: 'quest/status-set', questId: quest.id, status: toggle.to })}
        >
          {toggle.label}
        </button>
        <button
          type="button"
          className="quest-board__button"
          onClick={() => onSetMode({ kind: 'editing', id: quest.id })}
        >
          Edit
        </button>
        <button
          type="button"
          className="quest-board__button"
          onClick={() => onSetMode({ kind: 'recolouring', id: quest.id })}
        >
          Colour
        </button>
        <button
          type="button"
          className="quest-board__button"
          onClick={() => onSetMode({ kind: 'confirming-delete', id: quest.id })}
        >
          Delete
        </button>
      </header>

      <QuestCardMode
        quest={quest}
        mode={mode}
        onSetMode={onSetMode}
        dialogues={dialogues}
        zonesById={zonesById}
        zoneIndex={zoneIndex}
      />

      {linked.length === 0 ? (
        <p className="quest-card__empty">
          Nothing attached yet. Use <strong>Attach dialogue</strong>, or start a quest from the
          dialogue panel on the canvas.
        </p>
      ) : (
        <ol className="quest-card__dialogues">
          {linked.map((dialogue) => (
            <li key={dialogue.id} className="quest-card__dialogue">
              <LinkedDialogue
                dialogue={dialogue}
                zones={locationsOf(dialogue.id, zoneIndex, zonesById)}
              />
              <button
                type="button"
                className="quest-board__button"
                onClick={() =>
                  dispatch({
                    kind: 'quest/dialogue-detached',
                    questId: quest.id,
                    dialogueId: dialogue.id,
                  })
                }
              >
                Detach
              </button>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

/** Exhaustive over `QuestBoardMode`; a silently added mode fails to compile here. */
function QuestCardMode({
  quest,
  mode,
  onSetMode,
  dialogues,
  zonesById,
  zoneIndex,
}: Omit<BoardData, 'dialoguesById'> & {
  quest: Quest
  mode: QuestBoardMode
  onSetMode: (mode: QuestBoardMode) => void
}): ReactElement {
  switch (mode.kind) {
    case 'idle':
      return (
        <div className="quest-card__idle">
          {quest.note.trim() !== '' && <p className="quest-card__note">{quest.note}</p>}
          <button
            type="button"
            className="quest-board__button"
            onClick={() => onSetMode({ kind: 'attaching', id: quest.id })}
          >
            Attach dialogue
          </button>
        </div>
      )

    case 'editing':
      return <QuestForm quest={quest} onDone={() => onSetMode({ kind: 'idle' })} />

    // The swatches carry the raw hue rather than the accent: a done quest is drawn green, and
    // a palette showing twelve greens would say nothing about what is being picked.
    case 'recolouring':
      return (
        <div className="quest-card__palette" role="group" aria-label={`Colour of ${quest.name}`}>
          {QUEST_HUES.map((hue) => (
            <button
              key={hue}
              type="button"
              className="quest-card__swatch"
              style={questHueStyle(hue)}
              aria-label={`Hue ${hue}`}
              aria-pressed={hue === quest.hue}
              onClick={() => {
                dispatch({ kind: 'quest/hue-set', questId: quest.id, hue })
                onSetMode({ kind: 'idle' })
              }}
            />
          ))}
          <button
            type="button"
            className="quest-board__button"
            onClick={() => onSetMode({ kind: 'idle' })}
          >
            Cancel
          </button>
        </div>
      )

    case 'attaching':
      return (
        <DialoguePicker
          dialogues={dialogues}
          exclude={quest.dialogueIds}
          zonesById={zonesById}
          zoneIndex={zoneIndex}
          onPick={(dialogueId) =>
            dispatch({ kind: 'quest/dialogue-attached', questId: quest.id, dialogueId })
          }
          onClose={() => onSetMode({ kind: 'idle' })}
        />
      )

    case 'confirming-delete':
      return (
        <div className="quest-card__confirm" role="alert">
          {/* No cascade to warn about — a quest references dialogues, it never owns them. */}
          <span>Delete this quest? Its dialogues stay exactly where they are.</span>
          <button
            type="button"
            className="quest-board__button quest-board__button--danger"
            onClick={() => {
              dispatch({ kind: 'quest/deleted', questId: quest.id })
              onSetMode({ kind: 'idle' })
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="quest-board__button"
            onClick={() => onSetMode({ kind: 'idle' })}
          >
            Cancel
          </button>
        </div>
      )

    default:
      return assertNever(mode)
  }
}

/** How many matches a search shows before it stops listing and starts counting. */
const PICKER_LIMIT = 25

/**
 * Attaching, by search over NPC name and the line itself. A dialogue logged as a picture and not
 * yet transcribed is reachable by NPC name — and by an empty query, which lists everything unattached
 * newest first, because the line just logged is the one most likely being filed.
 */
function DialoguePicker({
  dialogues,
  exclude,
  zonesById,
  zoneIndex,
  onPick,
  onClose,
}: {
  dialogues: readonly Dialogue[]
  exclude: readonly DialogueId[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  onPick: (id: DialogueId) => void
  onClose: () => void
}): ReactElement {
  const [query, setQuery] = useState('')

  const attached = useMemo(() => new Set(exclude), [exclude])
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const candidates = dialogues.filter((dialogue) => !attached.has(dialogue.id))
    const hits =
      needle === ''
        ? candidates
        : candidates.filter((dialogue) => dialogueSearchText(dialogue).includes(needle))
    return [...hits].sort((a, b) => b.spokenAt.localeCompare(a.spokenAt))
  }, [dialogues, attached, query])

  return (
    <div className="quest-picker">
      <div className="quest-picker__bar">
        <input
          className="quest-picker__input"
          type="search"
          value={query}
          autoFocus
          placeholder="Search by NPC or what was said"
          aria-label="Search dialogues"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        />
        <button type="button" className="quest-board__button" onClick={onClose}>
          Close
        </button>
      </div>

      {matches.length === 0 ? (
        <p className="quest-picker__empty">
          {dialogues.length === attached.size
            ? 'Every dialogue in the project is already attached.'
            : 'No dialogue matches that.'}
        </p>
      ) : (
        <ul className="quest-picker__list">
          {matches.slice(0, PICKER_LIMIT).map((dialogue) => (
            <li key={dialogue.id}>
              <button
                type="button"
                className="quest-picker__option"
                onClick={() => onPick(dialogue.id)}
              >
                <DialogueSummary
                  dialogue={dialogue}
                  zones={locationsOf(dialogue.id, zoneIndex, zonesById)}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {matches.length > PICKER_LIMIT && (
        <p className="quest-picker__more">
          …and {matches.length - PICKER_LIMIT} more. Narrow the search.
        </p>
      )}
    </div>
  )
}

/**
 * A linked line, as an anchor rather than a button: the hash *is* the navigation mechanism, so
 * middle-click and bookmarking work with no handler of ours. `focus` carries the map because a
 * pin on a distant map would otherwise be selected somewhere off screen.
 */
function LinkedDialogue({
  dialogue,
  zones,
}: {
  dialogue: Dialogue
  zones: readonly Zone[]
}): ReactElement {
  return (
    <a
      className="quest-card__link"
      href={formatRoute({
        kind: 'canvas',
        dialogueId: dialogue.id,
        focus: { kind: 'map', id: dialogue.mapId },
      })}
    >
      <DialogueSummary dialogue={dialogue} zones={zones} />
    </a>
  )
}

/** The one-line identity of a dialogue, shared by the linked list and the attach picker. */
function DialogueSummary({
  dialogue,
  zones,
}: {
  dialogue: Dialogue
  zones: readonly Zone[]
}): ReactElement {
  return (
    <>
      <ContentGlyph kind={dialogueContentKind(dialogue)} />
      <span className="quest-card__npc">{npcNameOf(dialogue)}</span>
      <span className="quest-card__snippet">{snippetOf(dialogue)}</span>
      <span className="quest-card__where">
        {zones.length === 0 ? (
          <span className="quest-card__nowhere">Outside any zone</span>
        ) : (
          zones.map((zone) => (
            <span key={zone.id} className="quest-card__zone" style={zoneHueStyle(zone.hue)}>
              {zone.name}
            </span>
          ))
        )}
      </span>
      <time className="quest-card__when" dateTime={dialogue.spokenAt}>
        {formatSpokenAt(dialogue.spokenAt)}
      </time>
    </>
  )
}

/**
 * Keyed by an id, for the O(1) lookups a card of linked ids needs. `T['id']` rather than a
 * second type parameter: a key parameter is only inferable from the constraint, which lands
 * as `unknown` and throws away the brand.
 */
function byId<T extends { id: PropertyKey }>(items: readonly T[]): ReadonlyMap<T['id'], T> {
  const map = new Map<T['id'], T>()
  for (const item of items) map.set(item.id, item)
  return map
}

/** The zones a dialogue sits in, most specific first — the order `zone-index.ts` returns. */
function locationsOf(
  dialogueId: DialogueId,
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
  zonesById: ReadonlyMap<ZoneId, Zone>,
): Zone[] {
  const zoneIds = zoneIndex.get(dialogueId) ?? []
  return zoneIds.flatMap((id) => {
    const zone = zonesById.get(id)
    return zone === undefined ? [] : [zone]
  })
}

/** The DOM id a quest's card is scrolled to when `?edit=<id>` names it. */
function questCardElementId(questId: QuestId): string {
  return `quest-card-${questId}`
}

function npcNameOf(dialogue: Dialogue): string {
  const trimmed = dialogue.npcName.trim()
  return trimmed === '' ? 'Unnamed NPC' : trimmed
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
 * The line if there is one, and what the pictures are otherwise — a dialogue can now carry both,
 * and the words are what identifies it.
 *
 * Whitespace is collapsed rather than truncated at a character count: the row is one line with
 * a CSS ellipsis, so the browser cuts it exactly where the column runs out — but a newline
 * would otherwise render as a space of unpredictable width in the middle of it.
 */
function snippetOf(dialogue: Dialogue): string {
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
function formatSpokenAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : SPOKEN_AT_FORMAT.format(date)
}

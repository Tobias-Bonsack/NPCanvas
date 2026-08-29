import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EditableRowDeleteConfirm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import type { Route } from '../app/route.ts'
import { formatRoute, navigate } from '../app/route.ts'
import { RowActions } from '../app/RowActions.tsx'
import type { QuestsViewState } from '../app/view-state.ts'
import { assertNever } from '../assert-never.ts'
import { DialogueRow, DialogueRowContent } from '../dialogue-row/DialogueRow.tsx'
import { dialogueSnippet, resolveZones } from '../dialogue-row/dialogue-summary.ts'
import { subsetByTimeAsc, subsetByTimeDesc } from '../dialogue/dialogue-order.ts'
import { npcKey, npcLabel } from '../insights/filters.ts'
import { indexDialoguesByZone } from '../map/zone-index.ts'
import { dialogueSearchTexts } from '../project/derived.ts'
import { newQuestId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type {
  Dialogue,
  DialogueId,
  ProjectFile,
  Quest,
  QuestId,
  QuestStatus,
  Zone,
  ZoneId,
} from '../project/types.ts'
import { QUEST_STATUSES } from '../project/types.ts'
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
    () => indexDialoguesByZone(project.dialogues, project.zones, project.maps),
    [project.dialogues, project.zones, project.maps],
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
        <button type="button" className="button--primary" onClick={createQuest}>
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
      <h2 className="quest-board__group-heading micro-label">
        {STATUS_LABEL[status]}
        <span className="count-pill">{quests.length}</span>
      </h2>
      {quests.length === 0 ? (
        <p className="quest-board__group-empty hint-text">Nothing here.</p>
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
  // Delete is `EditableRow`'s own, local state — the rest of the card's modes (`editing`,
  // `recolouring`, `attaching`) stay lifted into `QuestsViewState` because `?edit=<id>` has to
  // reach them from outside the card; nothing ever needs to deep-link into a delete confirmation.
  const editable = useEditableRow()

  // Chronological, because a quest is read as a sequence of what was heard when. ISO 8601
  // sorts lexicographically, so no Date is constructed per comparison.
  const linked = useMemo(() => {
    const found = quest.dialogueIds.flatMap((id) => {
      const dialogue = dialoguesById.get(id)
      return dialogue === undefined ? [] : [dialogue]
    })
    return subsetByTimeAsc(found, dialogues)
  }, [quest.dialogueIds, dialoguesById, dialogues])

  const toggle = STATUS_TOGGLE[quest.status]
  const name = questName(quest)
  const nameId = `${questCardElementId(quest.id)}-name`

  return (
    <article
      id={questCardElementId(quest.id)}
      className="quest-card card"
      data-status={quest.status}
      style={questAccentStyle(quest)}
      // A named region, the same pattern `QuestGroup` already uses — forty cards otherwise all
      // read as "quest-card" to anything that announces the region a control lives in.
      aria-labelledby={nameId}
    >
      <header className="quest-card__header row-actions-host">
        <h3 id={nameId} className="quest-card__name">
          {name}
        </h3>
        <span className="quest-card__linked-count hint-text">
          {quest.dialogueIds.length} {quest.dialogueIds.length === 1 ? 'dialogue' : 'dialogues'}
        </span>
        <RowActions>
          <button
            type="button"
            className="button"
            aria-label={`${toggle.label}: ${name}`}
            onClick={() => dispatch({ kind: 'quest/status-set', questId: quest.id, status: toggle.to })}
          >
            {toggle.label}
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Edit ${name}`}
            onClick={() => onSetMode({ kind: 'editing', id: quest.id })}
          >
            Edit
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Change the colour of ${name}`}
            onClick={() => onSetMode({ kind: 'recolouring', id: quest.id })}
          >
            Colour
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Delete ${name}`}
            onClick={editable.openDelete}
          >
            Delete
          </button>
        </RowActions>
      </header>

      {editable.mode === 'delete' ? (
        <EditableRowDeleteConfirm
          // No cascade to warn about — a quest references dialogues, it never owns them.
          message="Delete this quest? Its dialogues stay exactly where they are."
          onConfirm={() => dispatch({ kind: 'quest/deleted', questId: quest.id })}
          close={editable.close}
          className="quest-card__confirm"
          label={`Delete ${name}?`}
        />
      ) : (
        <QuestCardMode
          quest={quest}
          mode={mode}
          onSetMode={onSetMode}
          dialogues={dialogues}
          zonesById={zonesById}
          zoneIndex={zoneIndex}
        />
      )}

      {linked.length === 0 ? (
        <p className="quest-card__empty hint-text">
          Nothing attached yet. Use <strong>Attach dialogue</strong>, or start a quest from{' '}
          <a href={formatRoute({ kind: 'canvas', dialogueId: null, focus: null })}>
            the dialogue panel on the canvas
          </a>
          .
        </p>
      ) : (
        <ol className="quest-card__dialogues">
          {linked.map((dialogue) => (
            <li key={dialogue.id} className="quest-card__dialogue">
              <DialogueRow dialogue={dialogue} zones={resolveZones(dialogue.id, zoneIndex, zonesById)} />
              <button
                type="button"
                className="button"
                aria-label={`Detach ${npcLabel(npcKey(dialogue))}: ${dialogueSnippet(dialogue)} from ${name}`}
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
            className="button"
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
            className="button"
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
    const searchTexts = dialogueSearchTexts(dialogues)
    const candidates = dialogues.filter((dialogue) => !attached.has(dialogue.id))
    const hits =
      needle === ''
        ? candidates
        : candidates.filter((dialogue) => (searchTexts.get(dialogue.id) ?? '').includes(needle))
    return subsetByTimeDesc(hits, dialogues)
  }, [dialogues, attached, query])

  return (
    <div className="quest-picker">
      <div className="quest-picker__bar">
        <input
          className="quest-picker__input text-input"
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
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>

      {matches.length === 0 ? (
        <p className="quest-picker__empty hint-text">
          {dialogues.length === attached.size
            ? 'Every dialogue in the project is already attached.'
            : 'No dialogue matches that.'}
        </p>
      ) : (
        <ul className="quest-picker__list">
          {matches.slice(0, PICKER_LIMIT).map((dialogue) => (
            <li key={dialogue.id}>
              <button type="button" className="dialogue-row" onClick={() => onPick(dialogue.id)}>
                <DialogueRowContent
                  dialogue={dialogue}
                  zones={resolveZones(dialogue.id, zoneIndex, zonesById)}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {matches.length > PICKER_LIMIT && (
        <p className="quest-picker__more hint-text">
          …and {matches.length - PICKER_LIMIT} more. Narrow the search.
        </p>
      )}
    </div>
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

/** The DOM id a quest's card is scrolled to when `?edit=<id>` names it. */
function questCardElementId(questId: QuestId): string {
  return `quest-card-${questId}`
}

/** A quest created from a dialogue starts nameless, and a blank card is nothing to click on. */
function questName(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}


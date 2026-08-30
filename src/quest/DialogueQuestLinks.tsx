import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { formatRoute, navigate } from '../app/route.ts'
import { newQuestId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, Quest, QuestId } from '../project/types.ts'
import { nextQuestHue, questAccentStyle } from './quest-style.ts'
import './DialogueQuestLinks.css'

type LinkMode = { kind: 'idle' } | { kind: 'attaching' }

// Creating navigates to the board rather than editing a name here — a quest's name and note
// belong to one form.
export function DialogueQuestLinks({
  dialogue,
  quests,
}: {
  dialogue: Dialogue
  quests: readonly Quest[]
}): ReactElement {
  const [mode, setMode] = useState<LinkMode>({ kind: 'idle' })

  const dialogueId = dialogue.id
  const linked = useMemo(
    () => quests.filter((quest) => quest.dialogueIds.includes(dialogueId)),
    [quests, dialogueId],
  )

  function createQuest(): void {
    const quest: Quest = {
      id: newQuestId(),
      name: '',
      status: 'open',
      dialogueIds: [dialogueId],
      note: '',
      hue: nextQuestHue(quests),
    }
    dispatch({ kind: 'quest/added', quest })
    navigate({ kind: 'quests', editQuestId: quest.id })
  }

  return (
    <section className="dialogue-quests">
      <h3 className="micro-label">Quests</h3>

      {linked.length === 0 ? (
        <p className="dialogue-quests__empty hint-text">In no quest yet.</p>
      ) : (
        <ul className="dialogue-quests__list">
          {linked.map((quest) => (
            <li key={quest.id} className="dialogue-quests__item">
              <a
                className="dialogue-quests__link"
                style={questAccentStyle(quest)}
                href={formatRoute({ kind: 'quests', editQuestId: quest.id })}
              >
                {questName(quest)}
              </a>
              <button
                type="button"
                className="button"
                onClick={() =>
                  dispatch({ kind: 'quest/dialogue-detached', questId: quest.id, dialogueId })
                }
              >
                Detach
              </button>
            </li>
          ))}
        </ul>
      )}

      {mode.kind === 'attaching' ? (
        <QuestPicker
          quests={quests}
          exclude={linked}
          onPick={(questId) => {
            dispatch({ kind: 'quest/dialogue-attached', questId, dialogueId })
            setMode({ kind: 'idle' })
          }}
          onClose={() => setMode({ kind: 'idle' })}
        />
      ) : (
        <div className="dialogue-quests__actions">
          <button
            type="button"
            className="button"
            disabled={quests.length === linked.length}
            title={
              quests.length === 0
                ? 'No quests exist yet — create one below'
                : quests.length === linked.length
                  ? 'Already attached to every quest in the project'
                  : 'Attach this dialogue to a quest that already exists'
            }
            onClick={() => setMode({ kind: 'attaching' })}
          >
            Attach to existing quest
          </button>
          <button type="button" className="button" onClick={createQuest}>
            Create quest from this dialogue
          </button>
        </div>
      )}
    </section>
  )
}

// Open quests first, then done ones — a quest being attached to is almost always in progress.
function QuestPicker({
  quests,
  exclude,
  onPick,
  onClose,
}: {
  quests: readonly Quest[]
  exclude: readonly Quest[]
  onPick: (id: QuestId) => void
  onClose: () => void
}): ReactElement {
  const [query, setQuery] = useState('')

  const attached = useMemo(() => new Set(exclude.map((quest) => quest.id)), [exclude])
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const candidates = quests.filter(
      (quest) =>
        !attached.has(quest.id) &&
        (needle === '' || questName(quest).toLowerCase().includes(needle)),
    )
    return [...candidates].sort((a, b) => statusRank(a) - statusRank(b))
  }, [quests, attached, query])

  return (
    // stopPropagation so Escape closes only this picker, not DialoguePanel's window-bound
    // Escape-to-close listener too.
    <div
      className="dialogue-quests__picker"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="dialogue-quests__bar">
        <input
          className="dialogue-quests__input text-input"
          type="search"
          value={query}
          autoFocus
          placeholder="Search quests"
          aria-label="Search quests"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>

      {matches.length === 0 ? (
        <p className="dialogue-quests__empty hint-text">No quest matches that.</p>
      ) : (
        <ul className="dialogue-quests__list">
          {matches.map((quest) => (
            <li key={quest.id}>
              <button
                type="button"
                className="dialogue-quests__option"
                style={questAccentStyle(quest)}
                onClick={() => onPick(quest.id)}
              >
                {questName(quest)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function statusRank(quest: Quest): number {
  return quest.status === 'open' ? 0 : 1
}

function questName(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}

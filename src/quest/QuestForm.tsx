import type { ReactElement } from 'react'
import { useId } from 'react'
import { dispatch } from '../project/store.ts'
import type { Quest } from '../project/types.ts'
import { useFieldDraft } from '../use-field-draft.ts'

/**
 * Edits an existing quest's `name` and `note`. There is no Save button — the same contract
 * `DialogueForm` has, and for the same reason: persistence is autosave's job, and a Save
 * button would let the document and the folder disagree about what the user believes they
 * typed. Both fields are `useFieldDraft`s rather than per-keystroke dispatches, because a
 * copy of `quests` rebuilds `questsByDialogue` and re-renders every pin behind the board.
 *
 * Creation is therefore still not a draft this form holds. `QuestBoard` dispatches `quest/added`
 * with a placeholder name and opens this form on the result, which is also what lets #17
 * create a quest from a dialogue and land the caret in the same field. The card around this
 * form is keyed on the quest, so leaving the editor unmounts it — which is what flushes.
 */
export function QuestForm({ quest, onDone }: { quest: Quest; onDone: () => void }): ReactElement {
  const fieldId = useId()
  const questId = quest.id

  const nameDraft = useFieldDraft(quest.name, (name) =>
    dispatch({ kind: 'quest/renamed', questId, name }),
  )
  const noteDraft = useFieldDraft(quest.note, (note) =>
    dispatch({ kind: 'quest/note-set', questId, note }),
  )

  return (
    <form
      className="quest-form"
      onSubmit={(event) => {
        event.preventDefault()
        onDone()
      }}
    >
      <div className="quest-form__field">
        <label className="quest-form__label" htmlFor={`${fieldId}-name`}>
          Quest
        </label>
        <input
          id={`${fieldId}-name`}
          className="quest-form__input"
          value={nameDraft.value}
          autoFocus
          placeholder="What are you chasing?"
          onChange={(event) => nameDraft.onChange(event.target.value)}
          onBlur={nameDraft.flush}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onDone()
          }}
        />
      </div>

      <div className="quest-form__field">
        <label className="quest-form__label" htmlFor={`${fieldId}-note`}>
          Note
        </label>
        <textarea
          id={`${fieldId}-note`}
          className="quest-form__textarea"
          value={noteDraft.value}
          rows={3}
          placeholder="What you know so far, and what you still need"
          onChange={(event) => noteDraft.onChange(event.target.value)}
          onBlur={noteDraft.flush}
        />
      </div>

      {/* Submit only closes the editor — leaving it flushes what is still in the fields. */}
      <button type="submit" className="quest-board__button">
        Done
      </button>
    </form>
  )
}

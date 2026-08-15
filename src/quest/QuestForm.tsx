import type { ReactElement } from 'react'
import { useId } from 'react'
import { dispatch } from '../project/store.ts'
import type { Quest } from '../project/types.ts'

/**
 * Edits an existing quest's `name` and `note`, dispatching per keystroke — the same contract
 * `DialogueForm` has, and for the same reason: persistence is autosave's job, and a Save
 * button would let the document and the folder disagree about what the user believes they
 * typed.
 *
 * Creation is therefore not a draft this form holds. `QuestBoard` dispatches `quest/added`
 * with a placeholder name and opens this form on the result, which is also what lets #17
 * create a quest from a dialogue and land the caret in the same field.
 */
export function QuestForm({ quest, onDone }: { quest: Quest; onDone: () => void }): ReactElement {
  const fieldId = useId()
  const questId = quest.id

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
          value={quest.name}
          autoFocus
          placeholder="What are you chasing?"
          onChange={(event) =>
            dispatch({ kind: 'quest/renamed', questId, name: event.target.value })
          }
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
          value={quest.note}
          rows={3}
          placeholder="What you know so far, and what you still need"
          onChange={(event) =>
            dispatch({ kind: 'quest/note-set', questId, note: event.target.value })
          }
        />
      </div>

      {/* Submit only closes the editor — every keystroke is already in the document. */}
      <button type="submit" className="quest-board__button">
        Done
      </button>
    </form>
  )
}

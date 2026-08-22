import type { ReactElement } from 'react'
import { useId } from 'react'
import type { RelevanceTag, RelevanceTagId } from '../project/types.ts'
import { relevanceHueStyle } from './relevance.ts'

/**
 * Checkboxes, not a select: a dialogue carries any combination of tags, and there is no fixed
 * count of them to assume fits on screen — the list wraps onto further rows and scrolls within
 * a bounded height past roughly four of them (`DialogueForm.css`) rather than growing the panel
 * to match however many tags the project has. Click order is not preserved — the reducer
 * normalizes into the project's own `relevanceTags` order — so this hands up whatever set the
 * toggle produced and lets that be the authority.
 */
export function RelevancePicker({
  tags,
  value,
  onChange,
}: {
  tags: readonly RelevanceTag[]
  value: readonly RelevanceTagId[]
  onChange: (relevance: RelevanceTagId[]) => void
}): ReactElement {
  const groupId = useId()

  return (
    <fieldset className="dialogue-form__fieldset">
      <legend className="micro-label dialogue-form__legend">Relevance</legend>
      <div className="relevance-picker">
        {tags.map((tag) => {
          const inputId = `${groupId}-${tag.id}`
          const checked = value.includes(tag.id)
          return (
            <label
              key={tag.id}
              className="relevance-picker__tag"
              htmlFor={inputId}
              data-checked={checked ? 'true' : undefined}
              style={relevanceHueStyle(tag.hue)}
            >
              <input
                id={inputId}
                className="relevance-picker__input"
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, tag.id]
                      : value.filter((other) => other !== tag.id),
                  )
                }
              />
              {tag.name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

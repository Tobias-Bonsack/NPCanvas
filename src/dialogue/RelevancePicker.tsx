import type { ReactElement } from 'react'
import { useId } from 'react'
import type { RelevanceTag } from '../project/types.ts'
import { RELEVANCE_TAGS } from '../project/types.ts'
import { RELEVANCE_STYLE, relevanceHueStyle } from './relevance.ts'

/**
 * Checkboxes, not a select: a dialogue carries any combination of tags, and all four fit on
 * screen at once. Click order is not preserved — the reducer normalizes to `RELEVANCE_TAGS`
 * order — so this hands up whatever set the toggle produced and lets that be the authority.
 */
export function RelevancePicker({
  value,
  onChange,
}: {
  value: readonly RelevanceTag[]
  onChange: (relevance: RelevanceTag[]) => void
}): ReactElement {
  const groupId = useId()

  return (
    <fieldset className="dialogue-form__fieldset">
      <legend className="dialogue-form__legend">Relevance</legend>
      <div className="relevance-picker">
        {RELEVANCE_TAGS.map((tag) => {
          const inputId = `${groupId}-${tag}`
          const checked = value.includes(tag)
          return (
            <label
              key={tag}
              className="relevance-picker__tag"
              htmlFor={inputId}
              data-checked={checked ? 'true' : undefined}
              style={relevanceHueStyle(tag)}
            >
              <input
                id={inputId}
                className="relevance-picker__input"
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...value, tag] : value.filter((other) => other !== tag),
                  )
                }
              />
              {RELEVANCE_STYLE[tag].label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

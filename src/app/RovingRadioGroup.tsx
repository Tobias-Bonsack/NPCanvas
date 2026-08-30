import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react'
import { useRef } from 'react'

type Orientation = 'horizontal' | 'vertical'

// Preserves each existing caller's exact behaviour: a vertical group (ToolPicker) also accepted
// the horizontal arrow pair, a horizontal one (GrainPicker) did not accept the vertical pair.
function arrowStep(key: string, orientation: Orientation): number | null {
  if (key === 'ArrowRight') return 1
  if (key === 'ArrowLeft') return -1
  if (orientation === 'vertical') {
    if (key === 'ArrowDown') return 1
    if (key === 'ArrowUp') return -1
  }
  return null
}

/**
 * A roving-tabindex radio group: `role="radiogroup"`/`"radio"`, `tabIndex` on the selected item
 * alone, arrow keys moving focus and selection together with wrap-around. `ToolPicker` and
 * `GrainPicker` are this shape exactly; layout, orientation and how an option renders stay the
 * caller's.
 */
export function RovingRadioGroup<T>({
  className,
  ariaLabel,
  orientation,
  options,
  optionKey,
  selectedKey,
  buttonClassName,
  onChange,
  renderOption,
  optionTitle,
  optionAriaLabel,
}: {
  className: string
  ariaLabel: string
  orientation: Orientation
  options: readonly T[]
  optionKey: (option: T) => string
  selectedKey: string
  buttonClassName: string
  onChange: (option: T) => void
  renderOption: (option: T) => ReactNode
  optionTitle?: (option: T) => string
  optionAriaLabel?: (option: T) => string | undefined
}): ReactElement {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    const step = arrowStep(event.key, orientation)
    if (step === null) return
    event.preventDefault()
    const next = options[(index + step + options.length) % options.length]
    const key = optionKey(next)
    onChange(next)
    buttons.current[key]?.focus()
  }

  return (
    <div
      className={className}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
    >
      {options.map((option, index) => {
        const key = optionKey(option)
        const selected = key === selectedKey
        return (
          <button
            key={key}
            ref={(element) => {
              buttons.current[key] = element
            }}
            type="button"
            role="radio"
            className={buttonClassName}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            title={optionTitle?.(option)}
            aria-label={optionAriaLabel?.(option)}
            onClick={() => onChange(option)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {renderOption(option)}
          </button>
        )
      })}
    </div>
  )
}

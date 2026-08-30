import type { CSSProperties, ReactElement } from 'react'

/**
 * Colour, the third row mode beside `EditableRowRenameForm` and `EditableRowDeleteConfirm` (see
 * `EditableRow.tsx`) — one hue-swatch button per hue plus a cancel. `ZoneList`, `RelevanceTagList`
 * and `QuestBoard` are this shape exactly; the hue constant, the swatch class name, the style
 * function and what a pick dispatches all stay the caller's.
 */
export function HuePalette({
  swatchClassName,
  ariaLabel,
  hues,
  selectedHue,
  hueStyle,
  onSelect,
  onCancel,
}: {
  swatchClassName: string
  ariaLabel: string
  hues: readonly number[]
  selectedHue: number
  hueStyle: (hue: number) => CSSProperties
  onSelect: (hue: number) => void
  onCancel: () => void
}): ReactElement {
  return (
    <div className="hue-palette" role="group" aria-label={ariaLabel}>
      {hues.map((hue) => (
        <button
          key={hue}
          type="button"
          className={`hue-swatch ${swatchClassName}`}
          style={hueStyle(hue)}
          aria-label={`Hue ${hue}`}
          aria-pressed={hue === selectedHue}
          onClick={() => onSelect(hue)}
        />
      ))}
      <button type="button" className="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

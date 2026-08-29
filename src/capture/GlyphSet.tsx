import type { ReactElement } from 'react'
import { useAlertDialogFocus } from '../dialog-focus.ts'
import { dispatch } from '../project/store.ts'
import type { Glyph } from '../project/types.ts'
import { GlyphTile } from './GlyphTile.tsx'
import './GlyphSet.css'

/**
 * Everything the project has learned to read, and a way to take one entry back.
 *
 * Learning is self-correcting only while the tile keeps appearing: `mergeGlyphs` replaces on
 * identical bits, so a mistyped character is fixed by reading the box again. A tile wrongly ticked
 * *Not text* is not — it matches from then on, contributes nothing to `unknown`, and the learner
 * never asks about it a second time. Forgetting the entry is what puts such a tile back in front
 * of the learner, which is why this panel exists at all.
 *
 * No confirmation on the button. A removal is one undo step — `coalesceKeyFor` deliberately does
 * not coalesce `glyph/forgotten` — so the app already holds the answer to a misclick, and a prompt
 * per glyph would make correcting a handful of them a chore.
 *
 * Escape is handled by `useAlertDialogFocus`, on `document` in the capture phase: `DialoguePanel`
 * binds its own Escape-to-close on `window`, and one key press must not both close this and the
 * panel it was opened from.
 */
export function GlyphSet({
  glyphs,
  onClose,
}: {
  glyphs: readonly Glyph[]
  onClose: () => void
}): ReactElement {
  const ref = useAlertDialogFocus(onClose)
  return (
    <div className="glyph-set overlay-backdrop">
      <div
        ref={ref}
        className="glyph-set__panel card"
        role="dialog"
        aria-modal="true"
        aria-label="The alphabet this project has learned"
        tabIndex={-1}
      >
        <header className="panel-header">
          <h2 className="panel-title">
            {glyphs.length === 1 ? 'One glyph learned' : `${glyphs.length} glyphs learned`}
          </h2>
          <p className="glyph-set__hint hint-text">
            One alphabet for the whole project — every capture profile reads with it. Forgetting a
            glyph puts its tile back in front of the learner the next time it is on screen, and undo
            brings it back.
          </p>
        </header>

        {glyphs.length === 0 ? (
          <p className="glyph-set__empty hint-text">
            Nothing learned yet. Read a text box and name the tiles it asks about.
          </p>
        ) : (
          <ul className="glyph-set__list">
            {sortForReading(glyphs).map((glyph) => (
              <li key={glyph.bits} className="glyph-set__item glyph-row">
                <GlyphTile
                  bits={glyph.bits}
                  className="glyph-set__tile glyph-tile-frame"
                  label={glyph.char === '' ? 'A tile that is not text' : `The tile read as ${glyph.char}`}
                />
                <span
                  className={
                    glyph.char === '' ? 'glyph-set__char glyph-set__char--none hint-text' : 'glyph-set__char'
                  }
                >
                  {glyph.char === '' ? 'not text' : glyph.char}
                </span>
                <button
                  type="button"
                  className="glyph-set__forget button"
                  aria-label={
                    glyph.char === ''
                      ? 'Forget the tile marked not text'
                      : `Forget the tile read as ${glyph.char}`
                  }
                  onClick={() => dispatch({ kind: 'glyph/forgotten', bits: glyph.bits })}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}

        <footer className="panel-footer">
          <button type="button" className="glyph-set__button button--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

// Display only — the document's own order carries no meaning (`matchGlyph` is an exact lookup),
// so this sorts alphabetically, tiles that are not text last, purely so a wrong character can be
// found among sixty-odd right ones.
function sortForReading(glyphs: readonly Glyph[]): Glyph[] {
  return [...glyphs].sort((left, right) => {
    // Both halves matter: a project can hold several tiles that are not text, and a comparator
    // that answered 1 for two of them would not be a consistent ordering.
    const leftNone = left.char === ''
    const rightNone = right.char === ''
    if (leftNone !== rightNone) return leftNone ? 1 : -1
    return left.char.localeCompare(right.char) || left.bits.localeCompare(right.bits)
  })
}

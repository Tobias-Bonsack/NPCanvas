import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import type { Glyph } from '../project/types.ts'
import type { UnknownTile } from './glyph-matcher.ts'
import { GlyphTile } from './GlyphTile.tsx'
import './GlyphLearner.css'

/** What one tile has been answered with. `notText` produces the empty `char` the arrow needs. */
type Entry = { char: string; notText: boolean }

/**
 * Naming the tiles a profile could not read.
 *
 * The alphabet is closed after a dialogue or two: every tile typed in here is one the matcher
 * recognises for the rest of the project, so this panel stops appearing on its own rather than
 * becoming a step of the capture flow. Nothing is transcribed until every tile has an answer —
 * a half-learned box would produce a transcript with holes in it, silently.
 */
export function GlyphLearner({
  tiles,
  cancelLabel,
  onCancel,
  keepPicture,
  onConfirm,
}: {
  tiles: readonly UnknownTile[]
  /**
   * What the way out says it does. Required rather than defaulted to 'Cancel': the three callers
   * abandon three different things — a trial read, a queue that stays put, and a frame that is
   * thrown away — and one word for all of them would be wrong for two.
   */
  cancelLabel: string
  /** Escape and the leftmost button. Whatever it does, it must not be the destructive surprise. */
  onCancel: () => void
  /**
   * The middle way out, for the caller that has a frame worth keeping without a transcript. Label
   * and handler together rather than two optional props, so a button with no handler — or a handler
   * with no words on it — cannot be expressed.
   */
  keepPicture?: { label: string; onKeep: () => void }
  onConfirm: (glyphs: Glyph[]) => void
}): ReactElement {
  const [entries, setEntries] = useState<Entry[]>(() => tiles.map(() => ({ char: '', notText: false })))

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onCancel])

  function update(index: number, entry: Entry): void {
    setEntries(entries.map((current, at) => (at === index ? entry : current)))
  }

  const complete = entries.every((entry) => entry.notText || entry.char.trim() !== '')

  return (
    <div className="glyph-learner overlay-backdrop" role="dialog" aria-modal="true" aria-label="Learn the console's alphabet">
      <div className="glyph-learner__panel card">
        <header className="panel-header">
          <h2 className="panel-title">
            {tiles.length === 1 ? 'One tile is not in the alphabet yet' : `${tiles.length} tiles are not in the alphabet yet`}
          </h2>
          <p className="glyph-learner__hint hint-text">
            Type what each one says. A tile that is not a character — the blinking continuation
            arrow — is marked not text, and is dropped from every transcript afterwards.
          </p>
        </header>

        <ol className="glyph-learner__list">
          {tiles.map((tile, index) => (
            <li key={tile.bits} className="glyph-learner__item glyph-row">
              <GlyphTile bits={tile.bits} className="glyph-learner__tile glyph-tile-frame" label="Unrecognised tile" />
              <div className="glyph-learner__fields">
                <p className="glyph-learner__context">
                  {tile.context}
                  <span className="glyph-learner__position hint-text">
                    line {tile.row + 1}, tile {tile.column + 1}
                  </span>
                </p>
                <div className="glyph-learner__answer">
                  <input
                    className="glyph-learner__input text-input"
                    aria-label={`Character at line ${tile.row + 1}, tile ${tile.column + 1}`}
                    // Not one character: a Gen 1 font packs `'d` and `'s` into single tiles, and
                    // a one-character field would make them impossible to enter.
                    maxLength={4}
                    autoFocus={index === 0}
                    disabled={entries[index].notText}
                    value={entries[index].char}
                    onChange={(event) => update(index, { char: event.target.value, notText: false })}
                  />
                  <label className="glyph-learner__toggle">
                    <input
                      type="checkbox"
                      checked={entries[index].notText}
                      onChange={(event) => update(index, { char: '', notText: event.target.checked })}
                    />
                    Not text
                  </label>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <footer className="panel-footer">
          <button
            type="button"
            className="glyph-learner__button glyph-learner__button--cancel button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          {keepPicture !== undefined && (
            <button type="button" className="glyph-learner__button button" onClick={keepPicture.onKeep}>
              {keepPicture.label}
            </button>
          )}
          <button
            type="button"
            className="glyph-learner__button button button--primary-flat"
            disabled={!complete}
            onClick={() =>
              onConfirm(
                tiles.map((tile, index) => ({
                  char: entries[index].notText ? '' : entries[index].char.trim(),
                  bits: tile.bits,
                })),
              )
            }
          >
            Add to the alphabet
          </button>
        </footer>
      </div>
    </div>
  )
}

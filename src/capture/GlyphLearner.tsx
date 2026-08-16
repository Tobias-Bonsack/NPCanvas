import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import type { Glyph } from '../project/types.ts'
import { TILE_SIZE } from './capture-profile.ts'
import type { UnknownTile } from './glyph-matcher.ts'
import { isGlyphPixelSet, parseGlyphBits } from './glyph-matcher.ts'
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
  onCancel,
  onConfirm,
}: {
  tiles: readonly UnknownTile[]
  onCancel: () => void
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
    <div className="glyph-learner" role="dialog" aria-modal="true" aria-label="Learn the console's alphabet">
      <div className="glyph-learner__panel">
        <header className="glyph-learner__header">
          <h2 className="glyph-learner__title">
            {tiles.length === 1 ? 'One tile is not in the alphabet yet' : `${tiles.length} tiles are not in the alphabet yet`}
          </h2>
          <p className="glyph-learner__hint">
            Type what each one says. A tile that is not a character — the blinking continuation
            arrow — is marked not text, and is dropped from every transcript afterwards.
          </p>
        </header>

        <ol className="glyph-learner__list">
          {tiles.map((tile, index) => (
            <li key={tile.bits} className="glyph-learner__item">
              <TileBitmap bits={tile.bits} />
              <div className="glyph-learner__fields">
                <p className="glyph-learner__context">
                  {tile.context}
                  <span className="glyph-learner__position">
                    line {tile.row + 1}, tile {tile.column + 1}
                  </span>
                </p>
                <div className="glyph-learner__answer">
                  <input
                    className="glyph-learner__input"
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

        <footer className="glyph-learner__footer">
          <button type="button" className="glyph-learner__button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="glyph-learner__button glyph-learner__button--primary"
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

/**
 * One 8 × 8 tile, drawn large enough to read.
 *
 * An `<svg>` of one rect per ink pixel rather than an upscaled bitmap: this is the only place the
 * user judges what a tile *is*, and a scaled image would leave that to the browser's smoothing.
 */
function TileBitmap({ bits }: { bits: string }): ReactElement {
  const rows = parseGlyphBits(bits)
  const pixels: ReactElement[] = []
  if (rows !== null) {
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let column = 0; column < TILE_SIZE; column++) {
        if (!isGlyphPixelSet(rows, column, row)) continue
        pixels.push(<rect key={`${column},${row}`} x={column} y={row} width={1} height={1} />)
      }
    }
  }
  return (
    <svg
      className="glyph-learner__tile"
      viewBox={`0 0 ${TILE_SIZE} ${TILE_SIZE}`}
      role="img"
      aria-label="Unrecognised tile"
    >
      {pixels}
    </svg>
  )
}

import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { DialogueMedia, MediaId } from '../project/types.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { resolveGalleryIndex, stepGalleryIndex } from './gallery-index.ts'
import { MediaView } from './MediaView.tsx'
import './MediaGallery.css'

/**
 * A line's pictures, one frame at a time. Five frames of one sentence are alternatives to page
 * between, not a list read top to bottom — stacked, they push the form that produced them off
 * screen and make comparing frame 2 against frame 4 a scroll.
 *
 * It holds no selection of its own: the caller does, because the panel renders reorder and
 * remove controls for the *current* frame underneath, and two owners of "which frame is this
 * button about" is one too many. `onSelect` is the only way the frame changes.
 */
export function MediaGallery({
  media,
  label,
  selectedId,
  onSelect,
}: {
  media: readonly DialogueMedia[]
  /** Alt text for every frame — the NPC's name reads best, as in `MediaView`. */
  label: string
  selectedId: MediaId | null
  onSelect: (id: MediaId) => void
}): ReactElement | null {
  const index = resolveGalleryIndex(media, selectedId)
  const current = media[index]
  if (current === undefined) return null

  // With one frame the arrows, the counter and the strip are all noise: there is nothing to
  // page to, and "1 of 1" says only that the picture the reader is looking at exists.
  const paged = media.length > 1

  function page(delta: number): void {
    const next = media[stepGalleryIndex(index, delta, media.length)]
    if (next !== undefined) onSelect(next.id)
  }

  // Bound on the container rather than on `window`: the dossier renders one gallery per line,
  // and a global listener would page every one of them at once. The text-field guard is the
  // same one every keyboard shortcut in this app honours — a gallery sits inside a panel whose
  // line field is a textarea, and an arrow key there is a caret move.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!paged || isTextFieldFocused()) return
    if (event.key === 'ArrowLeft') page(-1)
    else if (event.key === 'ArrowRight') page(1)
    else return
    event.preventDefault()
  }

  return (
    <div className="media-gallery" onKeyDown={onKeyDown}>
      <div className="media-gallery__frame">
        {/* The frame fills the width the panel gives it; the strip below stays at the default,
            or a thumbnail would be blown up to the column's width. */}
        <MediaView media={current} label={label} fit="fill" />
      </div>

      {paged && (
        // A status, not a label: paging is what changes it, and a reader who cannot see the
        // frame change needs to be told the count moved. The thumbnail strip below and the
        // arrow keys are the only ways to page — see MediaGallery.css for why a third
        // (Previous/Next buttons) was one too many.
        <p className="media-gallery__count" role="status">
          Picture {index + 1} of {media.length}
        </p>
      )}

      {paged && (
        <div className="media-gallery__strip">
          {media.map((medium, position) => (
            <button
              key={medium.id}
              type="button"
              className="media-gallery__thumb"
              aria-current={medium.id === current.id ? 'true' : undefined}
              aria-label={`Picture ${position + 1}`}
              onClick={() => onSelect(medium.id)}
            >
              {/* `inert` because a thumbnail is a picture of a frame, not the frame: a video
                  rendered here still carries its own controls, and neither the pointer nor the
                  Tab key may reach them inside a button whose job is to select. */}
              <span className="media-gallery__thumb-media" inert>
                <MediaView media={medium} label="" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

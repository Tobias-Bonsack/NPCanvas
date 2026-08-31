import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { DialogueMedia, MediaId } from '../project/types.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { resolveGalleryIndex, stepGalleryIndex } from './gallery-index.ts'
import { MediaView } from './MediaView.tsx'
import './media.css'

// Frames to page between, not a list read top to bottom. Holds no selection of its own — the
// caller does, since the panel renders reorder/remove controls for the current frame underneath.
export function MediaGallery({
  media,
  label,
  selectedId,
  onSelect,
}: {
  media: readonly DialogueMedia[]
  label: string
  selectedId: MediaId | null
  onSelect: (id: MediaId) => void
}): ReactElement | null {
  const index = resolveGalleryIndex(media, selectedId)
  const current = media[index]
  if (current === undefined) return null

  // With one frame the arrows/counter/strip are all noise.
  const paged = media.length > 1

  function page(delta: number): void {
    const next = media[stepGalleryIndex(index, delta, media.length)]
    if (next !== undefined) onSelect(next.id)
  }

  // Bound on the container, not window — the dossier renders one gallery per line, and a
  // global listener would page every one at once.
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
        <MediaView media={current} label={label} fit="fill" />
      </div>

      {paged && (
        <p className="media-gallery__count hint-text" role="status">
          Picture {index + 1} of {media.length}
        </p>
      )}

      {paged && (
        <div className="media-gallery__strip">
          {media.map((medium, position) => (
            <button
              key={medium.id}
              type="button"
              className="media-gallery__thumb strip-thumb"
              aria-current={medium.id === current.id ? 'true' : undefined}
              aria-label={`Picture ${position + 1}`}
              onClick={() => onSelect(medium.id)}
            >
              {/* inert — a video thumbnail still carries controls that must not be reachable here. */}
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

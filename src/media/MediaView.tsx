import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import type { DialogueMedia } from '../project/types.ts'
import { useMediaUrl } from './media-url-cache.ts'
import './MediaView.css'

/**
 * Whether a picture is drawn at its own size or asked to fill the width it is given.
 *
 * An explicit choice at the call site rather than a change to the shared rule: `max-width: 100%`
 * is a ceiling, so a 640px capture stays 640px however wide the panel is dragged — which is the
 * whole point of dragging it. But the dossier renders the same component in a reading list,
 * where a tiny capture blown up to the column's width would be worse, and the thumbnail strip
 * would stop being a strip. Two values, both used.
 */
type MediaFit = 'intrinsic' | 'fill'

/**
 * One picture of a line. Exhaustive over `DialogueMedia` and over every `MediaUrl` state,
 * because a file the user deleted from `media/` outside the app is an ordinary situation — the
 * panel has to say so, not crash.
 *
 * The line itself is not rendered here: text is not a medium, and the two are separate fields
 * whose layouts differ per screen.
 */
export function MediaView({
  media,
  label,
  fit = 'intrinsic',
}: {
  media: DialogueMedia
  /** Alt text and the video's accessible name — the NPC's name reads best. */
  label: string
  /** Defaults to today's behaviour, so every existing caller renders exactly as it did. */
  fit?: MediaFit
}): ReactElement {
  const url = useMediaUrl(media.file)

  switch (url.kind) {
    case 'loading':
      return <p className="media-view__notice hint-text">Loading {media.file.fileName}…</p>

    case 'missing':
      return (
        <p className="media-view__notice hint-text" role="alert">
          {media.file.fileName} is no longer in the project’s media folder.
        </p>
      )

    case 'failed':
      return (
        <p className="media-view__notice hint-text" role="alert">
          {media.file.fileName} could not be read: {url.message}
        </p>
      )

    case 'ready':
      return <MediaElement media={media} label={label} url={url.url} fit={fit} />

    default:
      return assertNever(url)
  }
}

/** Exhaustive over the media kinds; `width`/`height` come from the probe, so nothing reflows. */
function MediaElement({
  media,
  label,
  url,
  fit,
}: {
  media: DialogueMedia
  label: string
  url: string
  fit: MediaFit
}): ReactElement {
  const filled = fit === 'fill'
  switch (media.kind) {
    case 'image':
    case 'gif':
      return (
        <img
          className={filled ? 'media-view__image media-view__image--fill' : 'media-view__image'}
          src={url}
          alt={label}
          width={media.width}
          height={media.height}
        />
      )

    case 'video':
      return (
        <video
          className={filled ? 'media-view__video media-view__video--fill' : 'media-view__video'}
          src={url}
          // Never autoplay and never preload the whole clip: a panel that opens on selection
          // must not start pulling megabytes, let alone make noise.
          preload="metadata"
          controls
          aria-label={label}
          width={media.width}
          height={media.height}
        />
      )

    default:
      return assertNever(media)
  }
}

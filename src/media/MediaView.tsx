import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import type { DialogueMedia } from '../project/types.ts'
import { useMediaUrl } from './media-url-cache.ts'
import './MediaView.css'

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
}: {
  media: DialogueMedia
  /** Alt text and the video's accessible name — the NPC's name reads best. */
  label: string
}): ReactElement {
  const url = useMediaUrl(media.file)

  switch (url.kind) {
    case 'loading':
      return <p className="media-view__notice">Loading {media.file.fileName}…</p>

    case 'missing':
      return (
        <p className="media-view__notice" role="alert">
          {media.file.fileName} is no longer in the project’s media folder.
        </p>
      )

    case 'failed':
      return (
        <p className="media-view__notice" role="alert">
          {media.file.fileName} could not be read: {url.message}
        </p>
      )

    case 'ready':
      return <MediaElement media={media} label={label} url={url.url} />

    default:
      return assertNever(url)
  }
}

/** Exhaustive over the media kinds; `width`/`height` come from the probe, so nothing reflows. */
function MediaElement({
  media,
  label,
  url,
}: {
  media: DialogueMedia
  label: string
  url: string
}): ReactElement {
  switch (media.kind) {
    case 'image':
    case 'gif':
      return (
        <img
          className="media-view__image"
          src={url}
          alt={label}
          width={media.width}
          height={media.height}
        />
      )

    case 'video':
      return (
        <video
          className="media-view__video"
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

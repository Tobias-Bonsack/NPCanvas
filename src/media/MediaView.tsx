import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import type { DialogueMedia } from '../project/types.ts'
import { useMediaUrl } from './media-url-cache.ts'
import './media.css'

// `max-width: 100%` is a ceiling, so a 640px capture stays 640px in a dragged panel — but the
// dossier's reading list wants it filled to the column width instead. Two values, both used.
type MediaFit = 'intrinsic' | 'fill'

// A file the user deleted from media/ outside the app is an ordinary situation, not a crash.
export function MediaView({
  media,
  label,
  fit = 'intrinsic',
}: {
  media: DialogueMedia
  label: string
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

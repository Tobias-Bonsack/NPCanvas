import type { ReactElement } from 'react'
import { assertNever } from '../assert-never.ts'
import type { DialogueContent, DialogueMediaContent } from '../project/types.ts'
import { useMediaUrl } from './media-url-cache.ts'
import './MediaView.css'

/**
 * A dialogue's content, whatever variant it is. Exhaustive over `DialogueContent` and over
 * every `MediaUrl` state, because a file the user deleted from `media/` outside the app is an
 * ordinary situation — the panel has to say so, not crash.
 */
export function MediaView({
  content,
  label,
}: {
  content: DialogueContent
  /** Alt text and the video's accessible name — the NPC's name reads best. */
  label: string
}): ReactElement {
  // Split rather than switched here, because the media branches call a hook and the text
  // branch must not. The early return also narrows `content` for the component below.
  if (content.kind === 'text') {
    return <p className="media-view__text">{content.text}</p>
  }
  return <MediaFileView content={content} label={label} />
}

function MediaFileView({
  content,
  label,
}: {
  content: DialogueMediaContent
  label: string
}): ReactElement {
  const media = useMediaUrl(content.file)

  switch (media.kind) {
    case 'loading':
      return <p className="media-view__notice">Loading {content.file.fileName}…</p>

    case 'missing':
      return (
        <p className="media-view__notice" role="alert">
          {content.file.fileName} is no longer in the project’s media folder.
        </p>
      )

    case 'failed':
      return (
        <p className="media-view__notice" role="alert">
          {content.file.fileName} could not be read: {media.message}
        </p>
      )

    case 'ready':
      return <MediaElement content={content} label={label} url={media.url} />

    default:
      return assertNever(media)
  }
}

/** Exhaustive over the media kinds; `width`/`height` come from the probe, so nothing reflows. */
function MediaElement({
  content,
  label,
  url,
}: {
  content: DialogueMediaContent
  label: string
  url: string
}): ReactElement {
  switch (content.kind) {
    case 'image':
    case 'gif':
      return (
        <img
          className="media-view__image"
          src={url}
          alt={label}
          width={content.width}
          height={content.height}
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
          width={content.width}
          height={content.height}
        />
      )

    default:
      return assertNever(content)
  }
}

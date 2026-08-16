import { assertNever } from '../assert-never.ts'
import { newMapId, newMediaId } from '../project/ids.ts'
import type {
  DialogueId,
  DialogueMedia,
  GameMap,
  MediaFile,
  MediaId,
  Point,
} from '../project/types.ts'
import { writeMediaFile } from '../storage/project-directory.ts'
import { invalidateMediaFile } from './media-url-cache.ts'

/**
 * MIME → extension, explicit and closed. The extension is **never** taken from the upload's
 * filename: that string is untrusted, and deriving the name from a freshly generated id
 * makes collisions in `media/` impossible by construction. See CLAUDE.md § Media contract.
 *
 * The value type carries `| undefined` because `noUncheckedIndexedAccess` is off — without
 * it, a miss types as `string` and the guard below is a compile error rather than a check.
 */
const IMAGE_EXTENSIONS: Readonly<Record<string, string | undefined>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/**
 * Copies a picked image into `media/`, probes its natural size, and returns the `GameMap`
 * for the caller to dispatch. The natural size **is** the map-local coordinate system, so it
 * is measured once here rather than read off a rendered `<img>` that may not have loaded yet.
 *
 * `origin` is supplied by the caller rather than computed here, so canvas placement policy
 * stays in `canvas-layout.ts` and the media layer never has to know what else is on screen.
 */
export async function importMapImage(file: File, origin: Point): Promise<GameMap> {
  const extension = IMAGE_EXTENSIONS[file.type]
  if (extension === undefined) {
    const supplied = file.type === '' ? 'an unrecognised file type' : file.type
    throw new Error(
      `${supplied} cannot be used as a map. Supported: ${Object.keys(IMAGE_EXTENSIONS).join(', ')}.`,
    )
  }

  const id = newMapId()
  const { width, height } = await probeImageSize(file)
  const fileName = `map-${id}.${extension}`
  await writeMediaFile(fileName, file)

  return {
    id,
    name: mapNameFrom(file.name),
    file: { fileName, mimeType: file.type, byteSize: file.size },
    width,
    height,
    origin,
    scale: 1,
  }
}

async function probeImageSize(file: File): Promise<{ width: number; height: number }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // A correct MIME type on a corrupt or truncated file. The decoder's own message is a
    // DOMException with no useful detail, so it is replaced rather than wrapped.
    throw new Error(`${file.name} could not be decoded as an image.`)
  }
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    // Frees the decoded frame immediately instead of waiting for GC — a large map is
    // tens of megabytes of bitmap that nothing else will ever read.
    bitmap.close()
  }
}

/** The upload's filename is unusable as a path but perfectly good as a default label. */
function mapNameFrom(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '').trim()
  return withoutExtension === '' ? 'Untitled map' : withoutExtension
}

// ---- dialogue media ----

/**
 * The whole project folder is read into memory on load, so a single huge clip makes every
 * later session slow. Warned about rather than blocked: it is the user's folder, and a short
 * capture at a high bitrate is a legitimate thing to log.
 */
const LARGE_FILE_BYTES = 20 * 1024 * 1024

/**
 * MIME → content kind and extension, explicit and closed, for the same reason the map table
 * above is: the extension is derived from the type, never from the untrusted upload name.
 *
 * A closed table rather than an `image/*` / `video/*` prefix rule, because a prefix rule
 * decides the *kind* but leaves the extension undecidable — `video/x-matroska` would have to
 * be written as some invented name Chromium then cannot play back anyway. Rejecting it names
 * the type, which is more useful than a file that silently fails to decode later.
 */
const DIALOGUE_MEDIA_TYPES: Readonly<
  Record<string, { kind: DialogueMedia['kind']; extension: string } | undefined>
> = {
  'image/png': { kind: 'image', extension: 'png' },
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/avif': { kind: 'image', extension: 'avif' },
  // Before the other image types in intent, not in position: a gif is animated, and the
  // canvas treats it differently from a still.
  'image/gif': { kind: 'gif', extension: 'gif' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/webm': { kind: 'video', extension: 'webm' },
  'video/ogg': { kind: 'video', extension: 'ogv' },
  'video/quicktime': { kind: 'video', extension: 'mov' },
}

/** The `accept` attribute for any control that takes dialogue media. */
export const DIALOGUE_MEDIA_ACCEPT = Object.keys(DIALOGUE_MEDIA_TYPES).join(',')

export type DialogueMediaImport = {
  media: DialogueMedia
  /** Non-null when the import succeeded but the file is big enough to be worth saying so. */
  warning: string | null
}

/**
 * Copies a picked file into `media/<dialogueId>-<mediaId>.<ext>`, probes its intrinsic size, and
 * returns the medium for the caller to dispatch. Both ids are in the name, so a dialogue can own
 * several files and a collision remains impossible by construction. The URL cache is invalidated
 * here rather than left to each caller, because a fresh id could still land on a name a previous
 * session wrote and then deleted.
 */
export async function importDialogueMedia(
  dialogueId: DialogueId,
  file: File,
): Promise<DialogueMediaImport> {
  const type = DIALOGUE_MEDIA_TYPES[file.type]
  if (type === undefined) {
    const supplied = file.type === '' ? 'an unrecognised file type' : file.type
    throw new Error(
      `${supplied} cannot be used as dialogue media. ` +
        `Supported: ${Object.keys(DIALOGUE_MEDIA_TYPES).join(', ')}.`,
    )
  }

  const id = newMediaId()
  // Probed before the write, so a corrupt file is rejected without leaving bytes in media/
  // that no dialogue references.
  const media = await probeMedia(id, type.kind, file, {
    fileName: `${dialogueId}-${id}.${type.extension}`,
    mimeType: file.type,
    byteSize: file.size,
  })

  await writeMediaFile(media.file.fileName, file)
  invalidateMediaFile(media.file.fileName)

  return { media, warning: largeFileWarning(file) }
}

/** Exhaustive over the media kinds, which is what keeps a new one from defaulting to a still. */
async function probeMedia(
  id: MediaId,
  kind: DialogueMedia['kind'],
  file: File,
  mediaFile: MediaFile,
): Promise<DialogueMedia> {
  switch (kind) {
    case 'image':
    case 'gif': {
      const { width, height } = await probeImageSize(file)
      return { id, kind, file: mediaFile, width, height }
    }
    case 'video': {
      const { width, height, durationMs } = await probeVideoSize(file)
      return { id, kind, file: mediaFile, width, height, durationMs }
    }
    default:
      return assertNever(kind)
  }
}

function largeFileWarning(file: File): string | null {
  if (file.size <= LARGE_FILE_BYTES) return null
  return (
    `This file is ${Math.round(file.size / (1024 * 1024))} MB. It was imported, but the whole ` +
    'project folder is read into memory on load, so a few of these will make opening slow.'
  )
}

/**
 * How long to wait for `loadedmetadata` before giving up on a clip.
 *
 * Not paranoia: a container Chromium half-recognises — a webm whose header carries no
 * duration, say — leaves the element in `HAVE_NOTHING` with neither `loadedmetadata` nor
 * `error` ever firing. Without a deadline the import promise never settles and the panel sits
 * on "Importing…" forever, with nothing to click and nothing in the console. Metadata for a
 * local file arrives in tens of milliseconds, so this only ever fires on that stuck case.
 */
const VIDEO_PROBE_TIMEOUT_MS = 10_000

/**
 * Video metadata off-DOM: an element that is never attached, given an object URL only long
 * enough for `loadedmetadata` to populate the intrinsic size and duration.
 */
async function probeVideoSize(
  file: File,
): Promise<{ width: number; height: number; durationMs: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  try {
    // Metadata is all this needs; `auto` would pull the whole clip through memory for a
    // measurement that is available in the first few kilobytes.
    video.preload = 'metadata'
    video.src = url

    await new Promise<void>((resolve, reject) => {
      const fail = (): void => {
        reject(new Error(`${file.name} could not be decoded as a video.`))
      }
      video.addEventListener('loadedmetadata', () => resolve(), { once: true })
      video.addEventListener('error', fail, { once: true })
      setTimeout(fail, VIDEO_PROBE_TIMEOUT_MS)
    })

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      // A stream with no known length reports Infinity, and `Math.round(Infinity)` is not a
      // storable number. Zero is the honest "unknown" and renders as no duration at all.
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
    }
  } finally {
    // Aborts any load still in flight, so revoking the URL below cannot race it and the
    // element is collectable immediately rather than after the fetch gives up.
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

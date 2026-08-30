import { assertNever } from '../assert-never.ts'
import { newMapId, newMediaId } from '../project/ids.ts'
import type {
  DialogueId,
  DialogueMedia,
  GameMap,
  MediaFile,
  MediaId,
  PendingCaptureId,
} from '../project/types.ts'
import { writeMediaFile } from '../storage/project-directory.ts'
import { invalidateMediaFile } from './media-url-cache.ts'

// `| undefined` because noUncheckedIndexedAccess is off — without it a miss types as `string`
// and the guard below is a compile error rather than a check.
const MAP_IMAGE_EXTENSIONS: Readonly<Record<string, string | undefined>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

export const MAP_IMAGE_ACCEPT = Object.keys(MAP_IMAGE_EXTENSIONS).join(',')

type ImportedMap = Omit<GameMap, 'origin'>

// Origin excluded deliberately: canvas placement stays in canvas-layout.ts, decided only once
// this map exists, so two quick imports (each awaiting the copy/decode below) can't collide.
export async function importMapImage(file: File): Promise<ImportedMap> {
  const extension = MAP_IMAGE_EXTENSIONS[file.type]
  if (extension === undefined) {
    const supplied = file.type === '' ? 'an unrecognised file type' : file.type
    throw new Error(
      `${supplied} cannot be used as a map. Supported: ${Object.keys(MAP_IMAGE_EXTENSIONS).join(', ')}.`,
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
    scale: 1,
  }
}

async function probeImageSize(file: File): Promise<{ width: number; height: number }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`${file.name} could not be decoded as an image.`)
  }
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    // Frees the decoded frame immediately instead of waiting for GC.
    bitmap.close()
  }
}

function mapNameFrom(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '').trim()
  return withoutExtension === '' ? 'Untitled map' : withoutExtension
}

// ---- dialogue media ----

// The whole project folder loads into memory, so one huge clip slows every later session —
// warned about, not blocked, since a short high-bitrate capture is legitimate.
const LARGE_FILE_BYTES = 20 * 1024 * 1024

// A closed table, not an image/*|video/* prefix rule: a prefix decides the kind but leaves the
// extension undecidable (e.g. video/x-matroska has no format Chromium can then play back).
const DIALOGUE_MEDIA_TYPES: Readonly<
  Record<string, { kind: DialogueMedia['kind']; extension: string } | undefined>
> = {
  'image/png': { kind: 'image', extension: 'png' },
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/avif': { kind: 'image', extension: 'avif' },
  'image/gif': { kind: 'gif', extension: 'gif' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/webm': { kind: 'video', extension: 'webm' },
  'video/ogg': { kind: 'video', extension: 'ogv' },
  'video/quicktime': { kind: 'video', extension: 'mov' },
}

export const DIALOGUE_MEDIA_ACCEPT = Object.keys(DIALOGUE_MEDIA_TYPES).join(',')

type DialogueMediaImport = {
  media: DialogueMedia
  warning: string | null
}

// ownerId (a DialogueId, or a PendingCaptureId while the watcher hasn't placed the line yet)
// only names the file, so pending-capture/placed can move the record without touching the file.
export async function importDialogueMedia(
  ownerId: DialogueId | PendingCaptureId,
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
  // Probed before the write so a corrupt file is rejected without leaving orphaned bytes.
  const media = await probeMedia(id, type.kind, file, {
    fileName: `${ownerId}-${id}.${type.extension}`,
    mimeType: file.type,
    byteSize: file.size,
  })

  await writeMediaFile(media.file.fileName, file)
  invalidateMediaFile(media.file.fileName)

  return { media, warning: largeFileWarning(file) }
}

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

// A container Chromium half-recognises (e.g. a webm with no duration in its header) leaves the
// element in HAVE_NOTHING firing neither loadedmetadata nor error, so without a deadline the
// import promise never settles. Local-file metadata normally arrives in tens of milliseconds.
const VIDEO_PROBE_TIMEOUT_MS = 10_000

async function probeVideoSize(
  file: File,
): Promise<{ width: number; height: number; durationMs: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  try {
    // `auto` would pull the whole clip through memory for a measurement metadata already gives.
    video.preload = 'metadata'
    video.src = url

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (): void => {
          reject(new Error(`${file.name} could not be decoded as a video.`))
        }
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', fail, { once: true })
        timer = setTimeout(fail, VIDEO_PROBE_TIMEOUT_MS)
      })
    } finally {
      clearTimeout(timer)
    }

    // A container with no decodable video track (audio-only webm, an unsupported codec) fires
    // loadedmetadata like any other and reports 0x0 — neither error nor the timeout catches it.
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error(`${file.name} has no video track that this browser can play.`)
    }

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      // Infinity (unknown-length stream) isn't storable — 0 is the honest "unknown".
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
    }
  } finally {
    // Aborts any load still in flight so revoking the URL below can't race it.
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

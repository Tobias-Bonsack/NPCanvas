import { newMapId } from '../project/ids.ts'
import type { GameMap } from '../project/types.ts'
import { writeMediaFile } from '../storage/project-directory.ts'

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
 * for the caller to dispatch. The natural size **is** the world coordinate system, so it is
 * measured once here rather than read off a rendered `<img>` that may not have loaded yet.
 */
export async function importMapImage(file: File): Promise<GameMap> {
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

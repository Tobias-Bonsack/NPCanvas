import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { memo } from 'react'
import { assertNever } from '../assert-never.ts'
import type { MediaUrl } from '../media/media-url-cache.ts'
import { useMediaUrl } from '../media/media-url-cache.ts'
import type { GameMap } from '../project/types.ts'
import { mapGroupStyle } from './map-group-style.ts'

// memo'd like PinLayer/ZoneLayer, worth stating here since MapCanvas builds these elements
// itself rather than passing them through children — without it a pan would re-run useMediaUrl
// and rebuild mapGroupStyle for every map, every frame.
export const MapImage = memo(function MapImage({
  map,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  crisp,
}: {
  map: GameMap
  selected: boolean
  // `null` under every tool but move-map, which is what makes maps immovable there.
  onPointerDown: ((event: ReactPointerEvent<HTMLDivElement>, map: GameMap) => void) | null
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
  // Whether the map is at or above 1:1 — image-rendering: pixelated is only right there; below
  // 1:1 it's a nearest-neighbour downsample that shimmers, so the browser's own filter is better.
  crisp: boolean
}): ReactElement {
  const media = useMediaUrl(map.file)

  return (
    <div
      className="map-canvas__map"
      data-selected={selected ? 'true' : undefined}
      data-draggable={onPointerDown === null ? undefined : 'true'}
      style={mapGroupStyle(map)}
      onPointerDown={onPointerDown === null ? undefined : (event) => onPointerDown(event, map)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {media.kind === 'ready' ? (
        <img
          className="map-canvas__image"
          src={media.url}
          alt={map.name}
          width={map.width}
          height={map.height}
          draggable={false}
          data-crisp={crisp ? 'true' : undefined}
          decoding="async" // millions of pixels — sync decode would block the frame
        />
      ) : (
        <div
          className="map-canvas__placeholder"
          style={{ width: `${map.width}px`, height: `${map.height}px` }}
        >
          <p className="map-canvas__notice" role={media.kind === 'loading' ? undefined : 'alert'}>
            <MediaNotice map={map} media={media} />
          </p>
        </div>
      )}
    </div>
  )
})

function MediaNotice({ map, media }: { map: GameMap; media: MediaUrl }): ReactElement | null {
  switch (media.kind) {
    case 'ready':
      return null

    case 'loading':
      return <>Loading {map.name}…</>

    case 'missing':
      return <>{map.file.fileName} is no longer in the project’s media folder.</>

    case 'failed':
      return (
        <>
          {map.name} could not be read: {media.message}
        </>
      )

    default:
      return assertNever(media)
  }
}

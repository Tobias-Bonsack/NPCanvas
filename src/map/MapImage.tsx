import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { memo } from 'react'
import { assertNever } from '../assert-never.ts'
import type { MediaUrl } from '../media/media-url-cache.ts'
import { useMediaUrl } from '../media/media-url-cache.ts'
import type { GameMap } from '../project/types.ts'
import { mapGroupStyle } from './map-group-style.ts'

/**
 * The map image, or a footprint-sized placeholder while it loads or if it has gone missing.
 * A placeholder rather than an overlay notice: with every map on screen at once, the message
 * has to say *which* map it is about, and occupying the map's own rectangle says it best.
 *
 * `memo` for the same reason `PinLayer` and `ZoneLayer` have it, and it needs stating because
 * this one is *not* passed through `children`: `MapCanvas` builds these elements itself, so a
 * pan — which re-renders `MapCanvas` per frame — would otherwise re-run `useMediaUrl` and
 * rebuild `mapGroupStyle` for every map, every frame. Every prop here is already viewport
 * independent, so the memo simply holds.
 *
 * Lives in its own file rather than in `MapCanvas.tsx` because it is the one seam there with no
 * coupling to canvas gesture state: a session editing the gestures never has to read it, and a
 * session editing the image layer never has to read them.
 */
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
  /** `null` under every tool but `move-map`, which is what makes maps immovable there. */
  onPointerDown: ((event: ReactPointerEvent<HTMLDivElement>, map: GameMap) => void) | null
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
  /**
   * Whether the map is drawn at or above 1:1. `image-rendering: pixelated` is the right filter
   * only there — it is what keeps game-map pixel art from smearing when magnified. Below 1:1 it
   * is a nearest-neighbour *downsample*, which drops whole rows of a fitted map and shimmers as
   * the canvas moves; the browser's own filter is the better one for that.
   */
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
          // A map image is millions of pixels; decoding it on the main thread blocks the
          // frame that was going to draw the rest of the canvas.
          decoding="async"
        />
      ) : (
        <div
          className="map-canvas__placeholder"
          style={{ width: `${map.width}px`, height: `${map.height}px` }}
        >
          {/* Counter-scaled in CSS, so the message stays legible however small the map is. */}
          <p className="map-canvas__notice" role={media.kind === 'loading' ? undefined : 'alert'}>
            <MediaNotice map={map} media={media} />
          </p>
        </div>
      )}
    </div>
  )
})

/** Exhaustive over the non-ready `MediaUrl` variants; `ready` renders the image instead. */
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

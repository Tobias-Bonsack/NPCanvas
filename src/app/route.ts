import { useSyncExternalStore } from 'react'
import { asDialogueId, asMapId } from '../project/ids.ts'
import type { DialogueId, MapId } from '../project/types.ts'

// Hash routing, not history routing: Pages serves static files, so history routing would
// need a `404.html` copy of `index.html`. The URL carries view state only, never data.

export type Route =
  | { kind: 'map'; mapId: MapId | null; dialogueId: DialogueId | null }
  | { kind: 'quests' }
  | { kind: 'insights' }

/** Shared reference, so an unparseable hash keeps returning the identical object. */
const FALLBACK: Route = { kind: 'map', mapId: null, dialogueId: null }

export function parseRoute(hash: string): Route {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash
  const [path = '', query = ''] = withoutHash.split('?')
  const segments = path.split('/').filter((segment) => segment.length > 0)

  switch (segments[0]) {
    case 'quests':
      return { kind: 'quests' }
    case 'insights':
      return { kind: 'insights' }
    case 'map': {
      const mapSegment = segments[1]
      const dialogueParam = new URLSearchParams(query).get('dialogue')
      return {
        kind: 'map',
        mapId: mapSegment ? asMapId(decodeURIComponent(mapSegment)) : null,
        dialogueId: dialogueParam ? asDialogueId(dialogueParam) : null,
      }
    }
    default:
      return FALLBACK
  }
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'quests':
      return '#/quests'
    case 'insights':
      return '#/insights'
    case 'map': {
      const path = route.mapId === null ? '#/map' : `#/map/${encodeURIComponent(route.mapId)}`
      if (route.dialogueId === null) return path
      return `${path}?dialogue=${encodeURIComponent(route.dialogueId)}`
    }
  }
}

// The snapshot getter must return a stable reference: parsing inside it hands
// useSyncExternalStore a fresh object every call and re-renders forever.
let cachedHash: string | null = null
let cachedRoute: Route = FALLBACK

function getRoute(): Route {
  const hash = window.location.hash
  if (hash !== cachedHash) {
    cachedHash = hash
    cachedRoute = parseRoute(hash)
  }
  return cachedRoute
}

function subscribeToHash(onHashChange: () => void): () => void {
  window.addEventListener('hashchange', onHashChange)
  return () => {
    window.removeEventListener('hashchange', onHashChange)
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribeToHash, getRoute)
}

export function navigate(route: Route): void {
  window.location.hash = formatRoute(route)
}

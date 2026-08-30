import { useSyncExternalStore } from 'react'
import { asDialogueId, asMapId, asQuestId, asZoneId } from '../project/ids.ts'
import type { DialogueId, MapId, QuestId, ZoneId } from '../project/types.ts'

// Hash routing, not history routing: Pages serves static files, so history routing would
// need a `404.html` copy of `index.html`. The URL carries view state only, never data.

// One union, not two parallel fields, so a second sidebar list reaches for the same channel.
export type FocusTarget = { kind: 'map'; id: MapId } | { kind: 'zone'; id: ZoneId }

export type Route =
  | {
      kind: 'canvas'
      dialogueId: DialogueId | null
      // One-shot intent: the canvas jumps here once, then clears it via a replacing navigation.
      focus: FocusTarget | null
    }
  | {
      kind: 'quests'
      // One-shot, same pattern as focus — lets the dialogue panel create a quest and land the
      // caret in its name field on the board.
      editQuestId: QuestId | null
    }
  | { kind: 'insights' }
  | { kind: 'settings' }

const FALLBACK: Route = { kind: 'canvas', dialogueId: null, focus: null }

export function parseRoute(hash: string): Route {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash
  const [path = '', query = ''] = withoutHash.split('?')
  const segments = path.split('/').filter((segment) => segment.length > 0)

  switch (segments[0]) {
    case 'quests': {
      const editParam = new URLSearchParams(query).get('edit')
      return { kind: 'quests', editQuestId: editParam ? asQuestId(editParam) : null }
    }
    case 'insights':
      return { kind: 'insights' }
    case 'settings':
      return { kind: 'settings' }
    // `map` is the pre-M3.5 path — every map is on screen now, but an old link must still land
    // on the canvas rather than render nothing.
    case 'canvas':
    case 'map': {
      const params = new URLSearchParams(query)
      const dialogueParam = params.get('dialogue')
      return {
        kind: 'canvas',
        dialogueId: dialogueParam ? asDialogueId(dialogueParam) : null,
        focus: parseFocus(params.get('focus')),
      }
    }
    default:
      return FALLBACK
  }
}

function parseFocus(raw: string | null): FocusTarget | null {
  if (raw === null) return null
  const [kind, id] = raw.split(':', 2)
  if (kind === 'map' && id !== undefined) return { kind: 'map', id: asMapId(id) }
  if (kind === 'zone' && id !== undefined) return { kind: 'zone', id: asZoneId(id) }
  return null
}

function formatFocus(focus: FocusTarget): string {
  return `${focus.kind}:${focus.id}`
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'quests':
      return route.editQuestId === null ? '#/quests' : `#/quests?edit=${route.editQuestId}`
    case 'insights':
      return '#/insights'
    case 'settings':
      return '#/settings'
    case 'canvas': {
      const params = new URLSearchParams()
      if (route.dialogueId !== null) params.set('dialogue', route.dialogueId)
      if (route.focus !== null) params.set('focus', formatFocus(route.focus))
      const query = params.toString()
      return query === '' ? '#/canvas' : `#/canvas?${query}`
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

// `replace` is for corrections and one-shot intents not meant to enter history. location.replace,
// not history.replaceState — replaceState doesn't fire hashchange, so useRoute would go stale.
export function navigate(route: Route, options?: { replace?: boolean }): void {
  const hash = formatRoute(route)
  if (options?.replace === true) {
    window.location.replace(hash)
    return
  }
  window.location.hash = hash
}

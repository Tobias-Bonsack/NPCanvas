import { useSyncExternalStore } from 'react'
import { asDialogueId, asMapId, asQuestId } from '../project/ids.ts'
import type { DialogueId, MapId, QuestId } from '../project/types.ts'

// Hash routing, not history routing: Pages serves static files, so history routing would
// need a `404.html` copy of `index.html`. The URL carries view state only, never data.

export type Route =
  | {
      kind: 'canvas'
      dialogueId: DialogueId | null
      /**
       * A one-shot navigation intent, not view state: the canvas jumps to this map once and
       * then clears the parameter with a replacing navigation. Left in the hash it would
       * fight a user who immediately pans away, re-focusing on every render.
       */
      focusMapId: MapId | null
    }
  | {
      kind: 'quests'
      /**
       * A one-shot intent, exactly like `focusMapId`: the board opens this quest's editor once
       * and then clears the parameter with a replacing navigation. It exists so the dialogue
       * panel can create a quest and land the caret in its name field, which lives on the
       * board — the hash carries *which card is open*, never any quest data.
       */
      editQuestId: QuestId | null
    }
  | { kind: 'insights' }

/** Shared reference, so an unparseable hash keeps returning the identical object. */
const FALLBACK: Route = { kind: 'canvas', dialogueId: null, focusMapId: null }

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
    // `map` is the pre-M3.5 path, when the canvas showed one map at a time and named it in
    // the hash. Every map is on screen now, so the id is dropped rather than honoured — but
    // an old link must still land on the canvas rather than render nothing.
    case 'canvas':
    case 'map': {
      const params = new URLSearchParams(query)
      const dialogueParam = params.get('dialogue')
      const focusParam = params.get('focus')
      return {
        kind: 'canvas',
        dialogueId: dialogueParam ? asDialogueId(dialogueParam) : null,
        focusMapId: focusParam ? asMapId(focusParam) : null,
      }
    }
    default:
      return FALLBACK
  }
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'quests':
      return route.editQuestId === null ? '#/quests' : `#/quests?edit=${route.editQuestId}`
    case 'insights':
      return '#/insights'
    case 'canvas': {
      const params = new URLSearchParams()
      if (route.dialogueId !== null) params.set('dialogue', route.dialogueId)
      if (route.focusMapId !== null) params.set('focus', route.focusMapId)
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

/**
 * `replace` is for corrections and one-shot intents the user did not ask to keep in history
 * — a deep link to a dialogue that has since been deleted, say. Pushing those would trap the
 * back button on a URL that immediately corrects itself again.
 *
 * `location.replace` rather than `history.replaceState`, because replaceState does not fire
 * `hashchange` and `useRoute` would keep serving the stale snapshot.
 */
export function navigate(route: Route, options?: { replace?: boolean }): void {
  const hash = formatRoute(route)
  if (options?.replace === true) {
    window.location.replace(hash)
    return
  }
  window.location.hash = hash
}

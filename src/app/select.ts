import { dispatch } from '../project/store.ts'
import type { DialogueId, MapId, ZoneId } from '../project/types.ts'
import { navigate } from './route.ts'

/**
 * The store's selection and the canvas route are one fact stored twice: `selection` is what the
 * watcher and the panel act on, and the canvas route's `dialogueId` is what a reload or a
 * bookmark restores. Every change to one must write the other, or a stale route param becomes a
 * selection waiting to silently come back — see #74. These four are the only way to change the
 * selection; nothing outside this file and the reducer itself may construct `selection/set`.
 *
 * Each navigates with `{ replace: true }`: a selection change refines what is on screen rather
 * than opening a new page, so Back should not walk backwards one selection at a time (see
 * `src/app/route.ts`'s note on `replace`). A caller that also wants to focus the canvas on a map
 * or a zone issues its own `navigate(..., { focus })` afterwards — that is a real navigation the
 * user asked for, not part of the selection invariant these four enforce.
 */

export function selectDialogue(id: DialogueId): void {
  dispatch({ kind: 'selection/set', selection: { kind: 'dialogue', id } })
  navigate({ kind: 'canvas', dialogueId: id, focus: null }, { replace: true })
}

export function selectZone(id: ZoneId): void {
  dispatch({ kind: 'selection/set', selection: { kind: 'zone', id } })
  navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
}

export function selectMap(id: MapId): void {
  dispatch({ kind: 'selection/set', selection: { kind: 'map', id } })
  navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
}

export function clearSelection(): void {
  dispatch({ kind: 'selection/set', selection: { kind: 'none' } })
  navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
}

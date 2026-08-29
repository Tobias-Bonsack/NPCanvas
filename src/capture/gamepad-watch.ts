import { useSyncExternalStore } from 'react'
import { getState } from '../project/store.ts'
import { triggerRecording } from './capture-watch.ts'
import { pressedEdges } from './gamepad-edges.ts'

// A gamepad button reaching the app without letting go of the controller (#111).
//
// The limit that made #107 abolish the keyboard trigger in the first place applies here too, and
// has to be said out loud rather than discovered: Chrome reports gamepad state only while the
// document has focus, so `navigator.getGamepads()` returns nothing useful for a background tab —
// a controller does not make the trigger global, it makes it reachable without letting go of the
// controller for a player whose emulator and browser share focus, or who alt-tabs between them.
//
// Module-level rather than component state, for the reason `capture-watch.ts`'s own opening
// comment gives: this has to outlive whichever screen happens to be mounted, and it is neither
// serialisable nor part of the document. A press is judged as a **rising edge** between two polls
// (`pressedEdges`, pure and browser-free) rather than a held button, which is what keeps "record"
// from firing every frame a trigger is held down.

/** Previous poll's button state, per `Gamepad.index` — a pad's own history, not a shared one. */
const previous = new Map<number, boolean[]>()

/** `requestAnimationFrame`'s own id, so a poll in flight can be cancelled when the loop stops. */
let frame: number | null = null

/** Whether the poll loop is currently running — the loop runs iff at least one pad is connected. */
let looping = false

/**
 * The next edge a binding row is waiting for, or `null` when nothing is listening. Set by
 * `listenForNextEdge`, and checked first in `onEdge` — a press taken as a binding must not also
 * be read as a trigger.
 */
let listener: ((buttonIndex: number) => void) | null = null

const listeners = new Set<() => void>()

function notify(): void {
  for (const one of listeners) one()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getConnected(): boolean {
  return looping
}

/** Whether any gamepad is connected right now, on its own subscription. */
export function useGamepadConnected(): boolean {
  return useSyncExternalStore(subscribe, getConnected)
}

function startLoop(): void {
  if (looping) return
  looping = true
  notify()
  frame = requestAnimationFrame(poll)
}

function stopLoop(): void {
  if (!looping) return
  looping = false
  notify()
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  previous.clear()
}

function anyGamepadConnected(): boolean {
  return navigator.getGamepads().some((pad) => pad !== null)
}

function poll(): void {
  for (const pad of navigator.getGamepads()) {
    if (pad === null) continue
    const current = pad.buttons.map((button) => button.pressed)
    const before = previous.get(pad.index) ?? []
    for (const buttonIndex of pressedEdges(before, current)) onEdge(buttonIndex)
    previous.set(pad.index, current)
  }
  if (!anyGamepadConnected()) {
    stopLoop()
    return
  }
  frame = requestAnimationFrame(poll)
}

/**
 * A button's rising edge, from any connected pad — bindings carry no gamepad identity (see
 * CLAUDE.md), so a second controller with the same layout works by construction. A listening
 * binding row takes the edge for itself; otherwise it is looked up against the project's own
 * bindings and, if bound, triggers exactly as the matching Captures-region button would.
 */
function onEdge(buttonIndex: number): void {
  if (listener !== null) {
    const answer = listener
    listener = null
    answer(buttonIndex)
    return
  }

  const app = getState()
  if (app.kind !== 'ready') return
  const binding = app.project.recorderBindings.find((b) => b.buttonIndex === buttonIndex)
  if (binding === undefined) return
  triggerRecording(binding.action === 'record-new' ? 'new' : 'extend')
}

/**
 * Takes the next button pressed on any connected pad as a binding rather than a trigger, once.
 * Returns a cancel function, so a binding row abandoned mid-listen — closed, or another row
 * started listening instead — does not leave a stale answer waiting to fire on the row that
 * replaced it.
 */
export function listenForNextEdge(onNextEdge: (buttonIndex: number) => void): () => void {
  listener = onNextEdge
  return () => {
    if (listener === onNextEdge) listener = null
  }
}

window.addEventListener('gamepadconnected', startLoop)
window.addEventListener('gamepaddisconnected', () => {
  if (!anyGamepadConnected()) stopLoop()
})

// A pad already connected before this module ever loaded — a reload mid-session, or one that was
// on before the page opened — fires no `gamepadconnected` event; Chrome only fires it on a change
// of state. Checked once at load, against the same condition `startLoop` itself is guarded by.
if (anyGamepadConnected()) startLoop()

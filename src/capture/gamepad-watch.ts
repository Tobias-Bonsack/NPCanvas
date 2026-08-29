import { useSyncExternalStore } from 'react'
import { getState, subscribe as subscribeToStore } from '../project/store.ts'
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
//
// The poll loop itself runs only while a pressed button could be acted on — a binding exists, or
// a binding row is listening for its next press — never merely because a pad is connected (#119):
// a pad sits idle on the quest board and the insights screen exactly as often as it is used, and
// `requestAnimationFrame` sixty times a second for nothing is a cost every screen paid before this.

/** One pad's button state, kept as two reused arrays rather than reallocated every poll. */
type PadState = { previous: boolean[]; current: boolean[] }

/** Previous and current poll's button state, per `Gamepad.index` — a pad's own history, not a shared one. */
const states = new Map<number, PadState>()

/** `requestAnimationFrame`'s own id, so a poll in flight can be cancelled when the loop stops. */
let frame: number | null = null

/** Whether the poll loop is currently scheduled. */
let looping = false

/**
 * Whether any gamepad is connected, driven by the `gamepadconnected`/`gamepaddisconnected`
 * listeners rather than by `looping`: the loop now stops long before a connected pad is gone, and
 * the settings screen still has to say a pad is there.
 */
let connected = false

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
  return connected
}

/** Whether any gamepad is connected right now, on its own subscription. */
export function useGamepadConnected(): boolean {
  return useSyncExternalStore(subscribe, getConnected)
}

function anyGamepadConnected(): boolean {
  return navigator.getGamepads().some((pad) => pad !== null)
}

function hasBindings(): boolean {
  const app = getState()
  return app.kind === 'ready' && app.project.recorderBindings.length > 0
}

/** Whether a pressed button has anywhere to go right now — the loop's own run condition. */
function shouldPoll(): boolean {
  return connected && (hasBindings() || listener !== null)
}

/** Starts or stops the loop to match `shouldPoll()`. Called on every input that can change it. */
function syncLoop(): void {
  if (shouldPoll()) startLoop()
  else stopLoop()
}

function startLoop(): void {
  if (looping) return
  looping = true
  frame = requestAnimationFrame(poll)
}

function stopLoop(): void {
  if (!looping) return
  looping = false
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  // Cleared rather than merely stale: `pressedEdges` reads a `previous` of length zero as "no
  // reading yet", which is what keeps a button held down across a stop/start from firing on the
  // very next poll — see `syncLoop`'s callers.
  states.clear()
}

/** This pad's reused buffers, sized to its current button count. */
function padState(padIndex: number, buttonCount: number): PadState {
  const existing = states.get(padIndex)
  if (existing !== undefined && existing.current.length === buttonCount) return existing
  const created: PadState = { previous: [], current: new Array<boolean>(buttonCount).fill(false) }
  states.set(padIndex, created)
  return created
}

function poll(): void {
  for (const pad of navigator.getGamepads()) {
    if (pad === null) continue
    const state = padState(pad.index, pad.buttons.length)
    for (let index = 0; index < pad.buttons.length; index++) {
      state.current[index] = pad.buttons[index].pressed
    }
    for (const buttonIndex of pressedEdges(state.previous, state.current)) onEdge(buttonIndex)
    // This frame's reading becomes the next one's `previous` — copied in place rather than a
    // fresh array, since `current` is about to be overwritten again next frame regardless.
    if (state.previous.length !== state.current.length) state.previous = new Array(state.current.length)
    for (let index = 0; index < state.current.length; index++) state.previous[index] = state.current[index]
  }
  if (!shouldPoll()) {
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
    // The listen that was keeping the loop alive just ended — if no binding exists yet either,
    // the loop has nothing left to act on.
    syncLoop()
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
 *
 * Starts the loop if nothing is bound yet — binding the first button is exactly that case — and
 * a cancelled or answered listen hands the decision of whether to keep running back to `syncLoop`.
 */
export function listenForNextEdge(onNextEdge: (buttonIndex: number) => void): () => void {
  listener = onNextEdge
  syncLoop()
  return () => {
    if (listener === onNextEdge) {
      listener = null
      syncLoop()
    }
  }
}

window.addEventListener('gamepadconnected', () => {
  connected = true
  notify()
  syncLoop()
})
window.addEventListener('gamepaddisconnected', () => {
  connected = anyGamepadConnected()
  notify()
  syncLoop()
})

// A pad already connected before this module ever loaded — a reload mid-session, or one that was
// on before the page opened — fires no `gamepadconnected` event; Chrome only fires it on a change
// of state. Checked once at load, against the same condition the disconnect handler re-checks.
if (anyGamepadConnected()) connected = true
syncLoop()

// `project.recorderBindings` changing — the first binding added, or the last one removed — is the
// other half of `shouldPoll()`, and it is not an event this module otherwise sees.
subscribeToStore(syncLoop)

import { useSyncExternalStore } from 'react'
import { assertNever } from '../assert-never.ts'
import { getState, subscribe as subscribeToStore } from '../project/store.ts'
import { cycleActiveCaptureProfile } from './active-profile.ts'
import { triggerRecording } from './capture-watch.ts'
import { pressedEdges } from './gamepad-edges.ts'

// Chrome reports gamepad state only while the document has focus, so `navigator.getGamepads()`
// returns nothing for a background tab — a controller reaches the app without letting go of it,
// but only when the emulator and browser share focus. Module-level, not component state, since
// this must outlive whichever screen is mounted and is neither serialisable nor part of the
// document. A press is a **rising edge** between two polls, not a held button, so "record" doesn't
// fire every frame a trigger stays down. The poll loop runs only while a press could be acted on —
// a binding exists, or a row is listening — never merely because a pad is connected.

type PadState = { previous: boolean[]; current: boolean[] }

const states = new Map<number, PadState>()

let frame: number | null = null
let looping = false

// Driven by the connect/disconnect listeners rather than `looping` — the loop stops long before a
// connected pad is gone, and the settings screen still has to say a pad is there.
let connected = false

// A press taken as a binding must not also be read as a trigger, so `onEdge` checks this first.
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

function shouldPoll(): boolean {
  return connected && (hasBindings() || listener !== null)
}

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
  // Cleared, not merely stale: `pressedEdges` reads a zero-length `previous` as "no reading yet",
  // keeping a button held across a stop/start from firing on the very next poll.
  states.clear()
}

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
    // Copied in place rather than a fresh array, since `current` is overwritten again next frame anyway.
    if (state.previous.length !== state.current.length) state.previous = new Array(state.current.length)
    for (let index = 0; index < state.current.length; index++) state.previous[index] = state.current[index]
  }
  if (!shouldPoll()) {
    stopLoop()
    return
  }
  frame = requestAnimationFrame(poll)
}

// From any connected pad — bindings carry no gamepad identity, so a second controller with the
// same layout works by construction.
function onEdge(buttonIndex: number): void {
  if (listener !== null) {
    const answer = listener
    listener = null
    answer(buttonIndex)
    syncLoop()
    return
  }

  const app = getState()
  if (app.kind !== 'ready') return
  const binding = app.project.recorderBindings.find((b) => b.buttonIndex === buttonIndex)
  if (binding === undefined) return
  switch (binding.action) {
    case 'record-new':
      triggerRecording('new')
      return
    case 'record-extend':
      triggerRecording('extend')
      return
    case 'cycle-profile':
      cycleActiveCaptureProfile(app.project.captureProfiles)
      return
    default:
      assertNever(binding.action)
  }
}

// Takes the next button pressed on any connected pad as a binding rather than a trigger, once.
// Returns a cancel function, so a binding row abandoned mid-listen leaves no stale answer.
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

// A pad already connected before this module loaded fires no `gamepadconnected` event — Chrome
// only fires it on a change of state.
if (anyGamepadConnected()) connected = true
syncLoop()

// `project.recorderBindings` changing is the other half of `shouldPoll()`, and not an event this
// module otherwise sees.
subscribeToStore(syncLoop)

import { assertNever } from '../assert-never.ts'
import type { Moment, Reel } from './reel.ts'

export const PLAY_SPEEDS = [0.5, 1, 2, 4] as const
export type PlaySpeed = (typeof PLAY_SPEEDS)[number]

export type JumpTarget = 'start' | 'end' | 'session-next' | 'session-prev'

/** Two cursors, not one — a line is its text and its pictures; see CLAUDE.md § "Cinema". */
export type Playhead = { moment: number; frame: number; playing: boolean; speed: PlaySpeed }

export type PlayheadAction =
  | { kind: 'toggle' }
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'tick' }
  | { kind: 'step'; by: 1 | -1 }
  // Not in #157's sketch: `,`/`.` need to move within a moment's own frames without resetting it
  // to 0 the way `step`/`seek`/`jump` do — see the closing comment on #157.
  | { kind: 'frame'; by: 1 | -1 }
  | { kind: 'seek'; moment: number }
  | { kind: 'jump'; to: JumpTarget }
  | { kind: 'speed'; speed: PlaySpeed }

// The fifty-frame Brock fight should still read as a film, not a strobe.
const MIN_FRAME_MS = 60

export function frameMsFor(moment: Moment, speed: PlaySpeed): number {
  const perFrame = moment.dwellMs / Math.max(1, moment.dialogue.media.length) / speed
  return Math.max(MIN_FRAME_MS, perFrame)
}

function clampMoment(index: number, reel: Reel): number {
  return Math.min(Math.max(index, 0), reel.moments.length - 1)
}

function frameCountAt(reel: Reel, momentIndex: number): number {
  return Math.max(1, reel.moments[momentIndex].dialogue.media.length)
}

function jumpTarget(current: number, to: JumpTarget, reel: Reel): number {
  switch (to) {
    case 'start':
      return 0
    case 'end':
      return reel.moments.length - 1
    case 'session-next': {
      const next = reel.sessions[reel.moments[current].sessionIndex + 1]
      return next === undefined ? current : next.firstMoment.index
    }
    case 'session-prev': {
      const previous = reel.sessions[reel.moments[current].sessionIndex - 1]
      return previous === undefined ? current : previous.firstMoment.index
    }
    default:
      return assertNever(to)
  }
}

/** Pure — see CLAUDE.md § "Testing scope"; `use-playhead.ts` is the only caller that touches time. */
export function playheadReducer(state: Playhead, action: PlayheadAction, reel: Reel): Playhead {
  switch (action.kind) {
    case 'toggle':
      return { ...state, playing: !state.playing }
    case 'play':
      return { ...state, playing: true }
    case 'pause':
      return { ...state, playing: false }
    case 'tick': {
      if (reel.moments.length === 0) return { ...state, playing: false }
      if (state.frame + 1 < frameCountAt(reel, state.moment)) return { ...state, frame: state.frame + 1 }
      if (state.moment + 1 < reel.moments.length) return { ...state, moment: state.moment + 1, frame: 0 }
      return { ...state, playing: false }
    }
    case 'step':
      if (reel.moments.length === 0) return state
      return { ...state, moment: clampMoment(state.moment + action.by, reel), frame: 0 }
    case 'frame': {
      if (reel.moments.length === 0) return state
      const count = frameCountAt(reel, state.moment)
      return { ...state, frame: Math.min(Math.max(state.frame + action.by, 0), count - 1) }
    }
    case 'seek':
      if (reel.moments.length === 0) return state
      return { ...state, moment: clampMoment(action.moment, reel), frame: 0 }
    case 'jump':
      if (reel.moments.length === 0) return state
      return { ...state, moment: jumpTarget(state.moment, action.to, reel), frame: 0 }
    case 'speed':
      return { ...state, speed: action.speed }
    default:
      return assertNever(action)
  }
}

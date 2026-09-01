import { useEffect, useReducer } from 'react'
import type { Dispatch } from 'react'
import { frameMsFor, playheadReducer } from './playhead.ts'
import type { Playhead, PlayheadAction } from './playhead.ts'
import type { Reel } from './reel.ts'

function initialPlayhead(moment: number): Playhead {
  return { moment, frame: 0, playing: false, speed: 1 }
}

/** Drives `playheadReducer` on a `setTimeout` per frame — each frame has its own duration. */
export function usePlayhead(reel: Reel, initialMoment: number): [Playhead, Dispatch<PlayheadAction>] {
  const [state, dispatch] = useReducer(
    (playhead: Playhead, action: PlayheadAction) => playheadReducer(playhead, action, reel),
    initialMoment,
    initialPlayhead,
  )

  useEffect(() => {
    if (!state.playing || reel.moments.length === 0) return
    const ms = frameMsFor(reel.moments[state.moment], state.speed)
    const timer = setTimeout(() => dispatch({ kind: 'tick' }), ms)
    return () => clearTimeout(timer)
  }, [state.playing, state.moment, state.frame, state.speed, reel])

  return [state, dispatch]
}

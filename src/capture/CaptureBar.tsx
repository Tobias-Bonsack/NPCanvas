import type { ReactElement } from 'react'
import { useState } from 'react'
import { assertNever } from '../assert-never.ts'
import { connectCaptureSource, disconnectCaptureSource, useCaptureSource } from './capture-session.ts'
import './CaptureBar.css'

/**
 * The screen-capture connection, as a strip in the dialogue panel.
 *
 * Stateless about the connection itself — that lives in `capture-session.ts`, because it has to
 * outlive this component: the bar unmounts whenever the selection changes or the quest board is
 * opened, and the picker must run once per session, not once per mount.
 */
export function CaptureBar(): ReactElement {
  const source = useCaptureSource()
  /**
   * A dismissed picker is not an error and not a state of the connection — nothing happened.
   * It is advice about one interaction, so it is local, like the panel's own import warnings.
   */
  const [cancelled, setCancelled] = useState(false)

  async function connect(): Promise<void> {
    setCancelled(false)
    const outcome = await connectCaptureSource()
    setCancelled(outcome === 'cancelled')
  }

  function row(): ReactElement {
    switch (source.kind) {
      case 'idle':
      case 'failed':
        return (
          <button type="button" className="capture-bar__connect" onClick={() => void connect()}>
            {source.kind === 'failed' ? 'Try connecting again' : 'Connect a screen or window'}
          </button>
        )
      case 'requesting':
        return (
          <button type="button" className="capture-bar__connect" disabled>
            Choose a source in the picker…
          </button>
        )
      case 'live':
        return (
          <>
            <p className="capture-bar__source">
              <span className="capture-bar__label">{source.label}</span>
              <span className="capture-bar__size">
                {source.frameWidth} × {source.frameHeight}
              </span>
            </p>
            <button
              type="button"
              className="capture-bar__button"
              onClick={() => disconnectCaptureSource()}
            >
              Disconnect
            </button>
          </>
        )
      default:
        return assertNever(source)
    }
  }

  return (
    <section className="capture-bar" aria-label="Screen capture">
      <h3 className="capture-bar__title">Capture source</h3>
      <div className="capture-bar__row">{row()}</div>
      <p className="capture-bar__hint">
        A capture connection cannot be stored the way the project folder can, so it ends with the
        page — after a reload, connect once more.
      </p>
      {cancelled && (
        <p className="capture-bar__note" role="status">
          Cancelled. Nothing is being captured.
        </p>
      )}
      {source.kind === 'failed' && (
        <p className="capture-bar__error" role="alert">
          {source.message}
        </p>
      )}
    </section>
  )
}

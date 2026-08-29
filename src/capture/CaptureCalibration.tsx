import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import type { CaptureProfile, PixelRect, Point } from '../project/types.ts'
import { detectScreenRect, detectTextRect } from './auto-calibrate.ts'
import type { FrozenFrame } from './capture-session.ts'
import { sampleNative } from './glyph-matcher.ts'
import type { ProfileCalibration, ScreenMapping } from './capture-profile.ts'
import {
  DEFAULT_NATIVE_HEIGHT,
  DEFAULT_NATIVE_WIDTH,
  TILE_SIZE,
  frameToNative,
  nativeToFrame,
  profileApplies,
  rectFromCorners,
  roundRect,
  snapToTileGrid,
  tileStep,
} from './capture-profile.ts'
import './CaptureCalibration.css'

// The screen comes first because the text box is stored in native pixels, and there is no native
// space to store it in until the screen is outlined.
type Step = 'screen' | 'text'

// In state rather than a ref, since it's drawn every move.
type Drag = { pointerId: number; from: Point; to: Point }

const ZOOMS = ['fit', 1, 2] as const
type Zoom = (typeof ZOOMS)[number]

// A stretched emulator window is legitimate, so this isn't an error, but a grid whose rows are
// half again as tall as its columns is the shape of a screen rect that swallowed a title bar.
const TILE_STEP_TOLERANCE = 0.05

// Only the first rectangle is measured freely — the screen rect plus the console's own resolution
// fix the 8-pixel tile grid exactly, so the text box snaps to whole tiles.
export function CaptureCalibration({
  frame,
  profile,
  onCancel,
  onSave,
}: {
  frame: FrozenFrame
  profile: CaptureProfile | null
  onCancel: () => void
  onSave: (name: string, calibration: ProfileCalibration) => void
}): ReactElement {
  const [name, setName] = useState(profile?.name ?? '')
  const [nativeWidth, setNativeWidth] = useState(profile?.nativeWidth ?? DEFAULT_NATIVE_WIDTH)
  const [nativeHeight, setNativeHeight] = useState(profile?.nativeHeight ?? DEFAULT_NATIVE_HEIGHT)
  // A screen rect measured against a different frame size means nothing, so it is dropped and
  // drawn again; the text box, being native-pixel, is still true.
  const [screenRect, setScreenRect] = useState<PixelRect | null>(() =>
    profile !== null && profileApplies(profile, frame.width, frame.height) ? profile.screenRect : null,
  )
  const [textRect, setTextRect] = useState<PixelRect | null>(profile?.textRect ?? null)
  const [step, setStep] = useState<Step>(() =>
    profile !== null && profileApplies(profile, frame.width, frame.height) ? 'text' : 'screen',
  )
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [measureFailed, setMeasureFailed] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onCancel])

  const nativeBounds = { width: nativeWidth, height: nativeHeight }
  const mapping: ScreenMapping | null =
    screenRect === null ? null : { screenRect, nativeWidth, nativeHeight }

  // Snapped already, so what is drawn is what is kept.
  function dragResult(current: Drag): PixelRect | null {
    const dragged = rectFromCorners(current.from, current.to)
    if (step === 'screen') return dragged
    if (mapping === null) return null
    const native = frameToNative(mapping, dragged)
    return snapToTileGrid(native, nativeBounds)
  }

  // Writes the same state a drag writes, so what is measured is drawn, nudgeable and still saved
  // by hand. A failure changes nothing — half a calibration is worse than none.
  function measure(): void {
    const detected = detectScreenRect(frame.pixels, nativeWidth, nativeHeight)
    if (detected === null) {
      setMeasureFailed(true)
      return
    }
    setMeasureFailed(false)
    setScreenRect(detected.screenRect)
    setTextRect(detectTextRect(sampleNative(frame.pixels, detected.screenRect, nativeWidth, nativeHeight)))
    setStep('text')
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0) return
    if (step === 'text' && mapping === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = framePoint(event)
    setDrag({ pointerId: event.pointerId, from: point, to: point })
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    if (drag === null || event.pointerId !== drag.pointerId) return
    setDrag({ ...drag, to: framePoint(event) })
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>): void {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const result = dragResult(drag)
    setDrag(null)
    if (result === null) return
    if (step === 'screen') {
      // A stray click must not wipe a screen rect that took aiming to place.
      if (result.width < 8 || result.height < 8) return
      setScreenRect(roundRect(result))
      setStep('text')
      return
    }
    setTextRect(result)
  }

  function framePoint(event: ReactPointerEvent<SVGSVGElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * frame.width,
      y: ((event.clientY - bounds.top) / bounds.height) * frame.height,
    }
  }

  function previewRect(): PixelRect | null {
    if (drag === null) return null
    const result = dragResult(drag)
    if (result === null) return null
    return step === 'screen' || mapping === null ? result : nativeToFrame(mapping, result)
  }

  const previewInFrame = previewRect()
  const textInFrame = mapping === null || textRect === null ? null : nativeToFrame(mapping, textRect)
  const saveable = name.trim() !== '' && screenRect !== null && textRect !== null

  return (
    <div className="capture-calibration overlay-backdrop" role="dialog" aria-modal="true" aria-label="Calibrate a capture profile">
      <div className="capture-calibration__panel card">
        <header className="capture-calibration__header">
          <h2 className="panel-title">
            {profile === null ? 'New capture profile' : `Re-calibrate ${profile.name}`}
          </h2>
          <p className="capture-calibration__step hint-text">{STEP_HINTS[step]}</p>
        </header>

        <div className="capture-calibration__viewport">
          <div className="capture-calibration__stage" style={stageStyle(frame, zoom)}>
            <img className="capture-calibration__frame" src={frame.url} alt="" draggable={false} />
            <svg
              className="capture-calibration__overlay"
              viewBox={`0 0 ${frame.width} ${frame.height}`}
              preserveAspectRatio="none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {screenRect !== null && (
                <rect
                  className="capture-calibration__screen"
                  x={screenRect.x}
                  y={screenRect.y}
                  width={screenRect.width}
                  height={screenRect.height}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {mapping !== null && <TileGrid mapping={mapping} />}
              {textInFrame !== null && (
                <rect
                  className="capture-calibration__text"
                  x={textInFrame.x}
                  y={textInFrame.y}
                  width={textInFrame.width}
                  height={textInFrame.height}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {previewInFrame !== null && (
                <rect
                  className="capture-calibration__preview"
                  x={previewInFrame.x}
                  y={previewInFrame.y}
                  width={previewInFrame.width}
                  height={previewInFrame.height}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
        </div>

        <div className="capture-calibration__controls">
          <fieldset className="capture-calibration__group">
            <legend className="capture-calibration__legend micro-label">Measure</legend>
            <button
              type="button"
              className="button capture-calibration__toggle capture-calibration__toggle--action"
              onClick={measure}
            >
              Measure it
            </button>
          </fieldset>

          <fieldset className="capture-calibration__group">
            <legend className="capture-calibration__legend micro-label">Step</legend>
            <button
              type="button"
              className="button capture-calibration__toggle"
              aria-pressed={step === 'screen'}
              onClick={() => setStep('screen')}
            >
              1 · Console screen
            </button>
            <button
              type="button"
              className="button capture-calibration__toggle"
              aria-pressed={step === 'text'}
              disabled={screenRect === null}
              onClick={() => setStep('text')}
            >
              2 · Text box
            </button>
          </fieldset>

          <fieldset className="capture-calibration__group">
            <legend className="capture-calibration__legend micro-label">Zoom</legend>
            {ZOOMS.map((option) => (
              <button
                key={String(option)}
                type="button"
                className="button capture-calibration__toggle"
                aria-pressed={zoom === option}
                onClick={() => setZoom(option)}
              >
                {option === 'fit' ? 'Fit' : `${option}:1`}
              </button>
            ))}
          </fieldset>

          <label className="capture-calibration__field micro-label">
            Profile name
            <input
              className="capture-calibration__input text-input"
              value={name}
              autoFocus
              placeholder="Pokémon Red"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <NumberField
            label="Native width"
            value={nativeWidth}
            min={TILE_SIZE}
            step={TILE_SIZE}
            onChange={setNativeWidth}
          />
          <NumberField
            label="Native height"
            value={nativeHeight}
            min={TILE_SIZE}
            step={TILE_SIZE}
            onChange={setNativeHeight}
          />
        </div>

        {screenRect !== null && (
          <div className="capture-calibration__controls">
            <p className="capture-calibration__legend capture-calibration__legend--row micro-label">
              Screen rect, frame px
            </p>
            <NumberField
              label="Left"
              value={screenRect.x}
              min={0}
              onChange={(x) => setScreenRect({ ...screenRect, x })}
            />
            <NumberField
              label="Top"
              value={screenRect.y}
              min={0}
              onChange={(y) => setScreenRect({ ...screenRect, y })}
            />
            <NumberField
              label="Width"
              value={screenRect.width}
              min={1}
              onChange={(width) => setScreenRect({ ...screenRect, width })}
            />
            <NumberField
              label="Height"
              value={screenRect.height}
              min={1}
              onChange={(height) => setScreenRect({ ...screenRect, height })}
            />
            <p className="capture-calibration__tile-size">
              One tile is {tileStep({ screenRect, nativeWidth, nativeHeight }).x.toFixed(2)} ×{' '}
              {tileStep({ screenRect, nativeWidth, nativeHeight }).y.toFixed(2)} frame px
            </p>
          </div>
        )}

        {measureFailed && (
          <p className="error-text" role="alert">
            Nothing in this frame repeats on a pixel grid — the source is most likely smoothing as
            it scales. Nothing was changed; draw the rectangles by hand.
          </p>
        )}
        {screenRect !== null &&
          tileStepMismatch({ screenRect, nativeWidth, nativeHeight }) > TILE_STEP_TOLERANCE && (
            <p className="error-text" role="alert">
              The tile is {tileStep({ screenRect, nativeWidth, nativeHeight }).x.toFixed(2)} wide but{' '}
              {tileStep({ screenRect, nativeWidth, nativeHeight }).y.toFixed(2)} tall. A stretched
              window can do that, but so can a screen rect that swallowed a title bar — and then no
              glyph will ever match.
            </p>
          )}

        <footer className="capture-calibration__footer">
          <p className="capture-calibration__readout">
            <span>
              Frame {frame.width} × {frame.height}
            </span>
            <span>
              {screenRect === null ? 'Screen not outlined' : describeRect('Screen', screenRect, 'frame px')}
            </span>
            <span>{textRect === null ? 'Text box not drawn' : describeTextRect(textRect)}</span>
          </p>
          <div className="capture-calibration__actions">
            <button type="button" className="capture-calibration__button button" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="capture-calibration__button button button--primary-flat"
              disabled={!saveable}
              onClick={() => {
                if (screenRect === null || textRect === null) return
                onSave(name.trim(), {
                  frameWidth: frame.width,
                  frameHeight: frame.height,
                  screenRect,
                  nativeWidth,
                  nativeHeight,
                  textRect,
                })
              }}
            >
              Save profile
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

const STEP_HINTS: Readonly<Record<Step, string>> = {
  screen: 'Drag a rectangle around the console screen itself — not the window, not the letterbox.',
  text: 'Drag roughly around the text box. It snaps to the tile grid, so sloppy is fine.',
}

// Lines rather than a `<pattern>` — the grid starts exactly at the screen rect and steps by a
// non-integer number of frame pixels, which is what makes a two-pixel-off rect visible as drift.
function TileGrid({ mapping }: { mapping: ScreenMapping }): ReactElement {
  const step = tileStep(mapping)
  const { screenRect } = mapping
  const columns = Math.floor(mapping.nativeWidth / TILE_SIZE)
  const rows = Math.floor(mapping.nativeHeight / TILE_SIZE)
  const lines: ReactElement[] = []
  for (let column = 1; column < columns; column++) {
    const x = screenRect.x + column * step.x
    lines.push(
      <line key={`c${column}`} x1={x} y1={screenRect.y} x2={x} y2={screenRect.y + screenRect.height} />,
    )
  }
  for (let row = 1; row < rows; row++) {
    const y = screenRect.y + row * step.y
    lines.push(
      <line key={`r${row}`} x1={screenRect.x} y1={y} x2={screenRect.x + screenRect.width} y2={y} />,
    )
  }
  return <g className="capture-calibration__grid">{lines}</g>
}

function tileStepMismatch(mapping: ScreenMapping): number {
  const step = tileStep(mapping)
  const largest = Math.max(step.x, step.y)
  return largest === 0 ? 0 : Math.abs(step.x - step.y) / largest
}

function stageStyle(frame: FrozenFrame, zoom: Zoom): { width: string; height?: string; aspectRatio?: string } {
  if (zoom === 'fit') return { width: '100%', aspectRatio: `${frame.width} / ${frame.height}` }
  return { width: `${frame.width * zoom}px`, height: `${frame.height * zoom}px` }
}

function NumberField({
  label,
  value,
  min,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  step?: number
  onChange: (value: number) => void
}): ReactElement {
  return (
    <label className="capture-calibration__field capture-calibration__field--narrow micro-label">
      {label}
      <input
        className="capture-calibration__input text-input"
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(readNumber(event.target.value, value, min))}
      />
    </label>
  )
}

// Holds its previous value rather than becoming NaN — clearing the box changes nothing until a
// number is in it.
function readNumber(raw: string, fallback: number, min: number): number {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < min) return fallback
  return value
}

function describeRect(label: string, rect: PixelRect, unit: string): string {
  return `${label} ${Math.round(rect.width)} × ${Math.round(rect.height)} ${unit} at ${Math.round(rect.x)}, ${Math.round(rect.y)}`
}

function describeTextRect(rect: PixelRect): string {
  return `Text box ${rect.width} × ${rect.height} native px — ${rect.width / TILE_SIZE} × ${rect.height / TILE_SIZE} tiles at ${rect.x}, ${rect.y}`
}

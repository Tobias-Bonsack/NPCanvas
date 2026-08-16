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

/**
 * Which rectangle the next drag draws. The screen comes first because the text box is stored in
 * native pixels, and there is no native space to store it in until the screen is outlined.
 */
type Step = 'screen' | 'text'

/** A drag in progress, in frame pixels. In state rather than a ref: it is drawn every move. */
type Drag = { pointerId: number; from: Point; to: Point }

/** How large the frozen frame is drawn. `fit` is for aiming, 1 and 2 for judging the grid. */
const ZOOMS = ['fit', 1, 2] as const
type Zoom = (typeof ZOOMS)[number]

/**
 * How far the two tile steps may differ before the bar says so, as a share of the larger.
 *
 * A stretched emulator window is legitimate, so this is not an error — but a grid whose rows are
 * half again as tall as its columns is the shape of a screen rect that swallowed a title bar, and
 * that mistake is invisible until `GlyphLearner` shows tiles nobody can name.
 */
const TILE_STEP_TOLERANCE = 0.05

/**
 * Outlining a console screen and its text box on one frozen frame.
 *
 * Two rectangles, and only the first is measured freely: the screen rect plus the console's own
 * resolution fix the 8-pixel tile grid exactly, so the text box can be dragged sloppily and snap
 * to whole tiles. The grid is drawn over the frame throughout, because a screen rect that is a
 * few pixels off is obvious there and invisible everywhere else — it would surface as glyphs
 * that never match, several issues later.
 */
export function CaptureCalibration({
  frame,
  profile,
  onCancel,
  onSave,
}: {
  frame: FrozenFrame
  /** The profile being re-calibrated, or `null` for a new one. */
  profile: CaptureProfile | null
  onCancel: () => void
  onSave: (name: string, calibration: ProfileCalibration) => void
}): ReactElement {
  const [name, setName] = useState(profile?.name ?? '')
  const [nativeWidth, setNativeWidth] = useState(profile?.nativeWidth ?? DEFAULT_NATIVE_WIDTH)
  const [nativeHeight, setNativeHeight] = useState(profile?.nativeHeight ?? DEFAULT_NATIVE_HEIGHT)
  // A screen rect measured against a different frame size means nothing, so it is dropped and
  // drawn again. The text box is native-pixel and therefore still true — see CLAUDE.md.
  const [screenRect, setScreenRect] = useState<PixelRect | null>(() =>
    profile !== null && profileApplies(profile, frame.width, frame.height) ? profile.screenRect : null,
  )
  const [textRect, setTextRect] = useState<PixelRect | null>(profile?.textRect ?? null)
  const [step, setStep] = useState<Step>(() =>
    profile !== null && profileApplies(profile, frame.width, frame.height) ? 'text' : 'screen',
  )
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [drag, setDrag] = useState<Drag | null>(null)
  /** Only ever a failure: a measurement that worked is visible as the rectangles it drew. */
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

  /** The rectangle a live drag would commit — snapped already, so what is drawn is what is kept. */
  function dragResult(current: Drag): PixelRect | null {
    const dragged = rectFromCorners(current.from, current.to)
    if (step === 'screen') return dragged
    if (mapping === null) return null
    return snapToTileGrid(frameToNative(mapping, dragged), nativeBounds)
  }

  /**
   * Measures the console screen out of the frozen frame, and the text box out of that.
   *
   * Writes the same state a drag writes, so what is measured is drawn, nudgeable and still saved
   * by hand. A failure changes nothing at all: half a calibration is worse than none, because the
   * half that is wrong is the half nobody looks at.
   */
  function measure(): void {
    const detected = detectScreenRect(frame.pixels, nativeWidth, nativeHeight)
    if (detected === null) {
      setMeasureFailed(true)
      return
    }
    setMeasureFailed(false)
    setScreenRect(detected.screenRect)
    setTextRect(detectTextRect(sampleNative(frame.pixels, detected.screenRect, nativeWidth, nativeHeight)))
    // The box is what the user came to check either way — found, it wants confirming; missed, it
    // wants drawing.
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
      // Rounded, because the number fields below are how a screen rect is actually finished:
      // a drag aims it, and single frame pixels are nudged in afterwards.
      setScreenRect(roundRect(result))
      // Straight on to the box, which is what the user came to draw.
      setStep('text')
      return
    }
    setTextRect(result)
  }

  /** Pointer position in frame pixels, independent of how large the frame is being drawn. */
  function framePoint(event: ReactPointerEvent<SVGSVGElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * frame.width,
      y: ((event.clientY - bounds.top) / bounds.height) * frame.height,
    }
  }

  /** The live drag, in frame pixels — the text step draws its snapped native rect mapped back. */
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
    <div className="capture-calibration" role="dialog" aria-modal="true" aria-label="Calibrate a capture profile">
      <div className="capture-calibration__panel">
        <header className="capture-calibration__header">
          <h2 className="capture-calibration__title">
            {profile === null ? 'New capture profile' : `Re-calibrate ${profile.name}`}
          </h2>
          <p className="capture-calibration__step">{STEP_HINTS[step]}</p>
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
            <legend className="capture-calibration__legend">Measure</legend>
            <button
              type="button"
              className="capture-calibration__toggle capture-calibration__toggle--action"
              onClick={measure}
            >
              Measure it
            </button>
          </fieldset>

          <fieldset className="capture-calibration__group">
            <legend className="capture-calibration__legend">Step</legend>
            <button
              type="button"
              className="capture-calibration__toggle"
              aria-pressed={step === 'screen'}
              onClick={() => setStep('screen')}
            >
              1 · Console screen
            </button>
            <button
              type="button"
              className="capture-calibration__toggle"
              aria-pressed={step === 'text'}
              disabled={screenRect === null}
              onClick={() => setStep('text')}
            >
              2 · Text box
            </button>
          </fieldset>

          <fieldset className="capture-calibration__group">
            <legend className="capture-calibration__legend">Zoom</legend>
            {ZOOMS.map((option) => (
              <button
                key={String(option)}
                type="button"
                className="capture-calibration__toggle"
                aria-pressed={zoom === option}
                onClick={() => setZoom(option)}
              >
                {option === 'fit' ? 'Fit' : `${option}:1`}
              </button>
            ))}
          </fieldset>

          <label className="capture-calibration__field">
            Profile name
            <input
              className="capture-calibration__input"
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

        {/* The grid's own numbers. A drag cannot place a rectangle to the pixel — a frame pixel
            is a fraction of a screen pixel at Fit zoom — and being one pixel out is exactly what
            makes the tile grid drift across the screen. So the rect is nudged, not redrawn. */}
        {screenRect !== null && (
          <div className="capture-calibration__controls">
            <p className="capture-calibration__legend capture-calibration__legend--row">
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
          <p className="capture-calibration__warning" role="alert">
            Nothing in this frame repeats on a pixel grid — the source is most likely smoothing as
            it scales. Nothing was changed; draw the rectangles by hand.
          </p>
        )}
        {screenRect !== null &&
          tileStepMismatch({ screenRect, nativeWidth, nativeHeight }) > TILE_STEP_TOLERANCE && (
            <p className="capture-calibration__warning" role="alert">
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
            <span>{screenRect === null ? 'Screen not outlined' : describeRect(screenRect, 'frame px')}</span>
            <span>{textRect === null ? 'Text box not drawn' : describeTextRect(textRect)}</span>
          </p>
          <div className="capture-calibration__actions">
            <button type="button" className="capture-calibration__button" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="capture-calibration__button capture-calibration__button--primary"
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

/**
 * The console's own 8-pixel cells, drawn over the frame. Lines rather than a `<pattern>`: the
 * grid has to start exactly at the screen rect and step by a non-integer number of frame pixels,
 * which is what makes a screen rect that is off by two pixels visible as drift across the screen.
 */
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
  // `vector-effect` does not inherit, so the stroke width is pinned on the lines themselves
  // through the stylesheet rather than as an attribute on this group.
  return <g className="capture-calibration__grid">{lines}</g>
}

/** How far the two tile steps differ, as a share of the larger. `0` is a perfectly square tile. */
function tileStepMismatch(mapping: ScreenMapping): number {
  const step = tileStep(mapping)
  const largest = Math.max(step.x, step.y)
  return largest === 0 ? 0 : Math.abs(step.x - step.y) / largest
}

/** `fit` lets CSS size the frame; a numeric zoom pins it and lets the viewport scroll. */
function stageStyle(frame: FrozenFrame, zoom: Zoom): { width: string; height?: string; aspectRatio?: string } {
  if (zoom === 'fit') return { width: '100%', aspectRatio: `${frame.width} / ${frame.height}` }
  return { width: `${frame.width * zoom}px`, height: `${frame.height * zoom}px` }
}

/**
 * One number in the calibration bar. Every value here is whole frame or native pixels, so the
 * arrow keys are a real adjustment tool rather than a rounding hazard.
 */
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
    <label className="capture-calibration__field capture-calibration__field--narrow">
      {label}
      <input
        className="capture-calibration__input"
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(readNumber(event.target.value, value, min))}
      />
    </label>
  )
}

/**
 * An emptied or half-typed field must not become NaN and take the whole tile grid with it, so
 * it holds its previous value — clearing the box changes nothing until a number is in it.
 */
function readNumber(raw: string, fallback: number, min: number): number {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < min) return fallback
  return value
}

function describeRect(rect: PixelRect, unit: string): string {
  return `Screen ${Math.round(rect.width)} × ${Math.round(rect.height)} ${unit} at ${Math.round(rect.x)}, ${Math.round(rect.y)}`
}

function describeTextRect(rect: PixelRect): string {
  return `Text box ${rect.width} × ${rect.height} native px — ${rect.width / TILE_SIZE} × ${rect.height / TILE_SIZE} tiles at ${rect.x}, ${rect.y}`
}

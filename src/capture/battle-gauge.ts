import type { PixelRect } from '../project/types.ts'
import type { PixelBuffer } from './glyph-matcher.ts'

// Whether the console is showing a fight, read off the pixels it is already drawing.
//
// The watcher cannot tell a fight from a conversation, because every box a fight prints is a
// legible box in the same text rect: `PIKATNUSS ben. DONNERSCHOCK!` reads exactly as well as
// anything an NPC says. What separates them is not in the text box at all — it is the opponent's
// status gauge above it, which the game draws for as long as an opponent stands and for no other
// reason.
//
// **A gauge, not a colour.** The obvious test is the coloured bar itself, and it does not work.
// Measured against all 533 pictures in a real project folder, of which exactly five hold the
// opponent gauge, "a saturated run of at least 16 px where the bar sits" returns 56 hits — 51 of
// them the town map, a purple library interior and plain grass, which are flat fills there. What
// the five real ones have and the fills do not is the *frame around* the bar, which the hardware
// draws as two dark rules with a light track between them:
//
//     y=18  ####################################################   dark rule
//     y=19  #GGGGGGGGGGGGGGGGGGGG...........................#      bar, then light track
//     y=20  #GGGGGGGGGGGGGGGGGGGG...........................#
//     y=21  ####################################################   dark rule
//
// That test returns exactly the five, and it reads no colour at all, so it measures the same on a
// monochrome console and on a fan translation with a repainted palette.
//
// Pure, and its own module for the reason `box-settle.ts` and `append-overlap.ts` are: the loop is
// four lines and the judgement around it is the rest. Where the rectangle sits is a `CaptureProfile`
// measurement — see CLAUDE.md § Domain and architecture decisions.

/**
 * How bright a pixel may be and still count as part of a rule — the **brightest channel**, not the
 * luminance.
 *
 * Luminance would be wrong here rather than merely different: a nearly-empty health bar is drawn in
 * saturated red, `rgb(248, 9, 8)`, whose luminance is 79 — close enough to this ceiling that the
 * bar itself would start reading as the rule that is supposed to frame it. Its brightest channel is
 * 248, which is not close to anything.
 */
const DARK_CEILING = 70

/**
 * The shortest dark run that counts as a rule.
 *
 * Measured, not guessed. The real rule is 52 px across a 56 px rectangle, and the sweep over those
 * 533 pictures is clean from 20 upwards and picks up its first false positive at 16. 24 sits in the
 * gap with room on both sides: far enough above the noise floor to stay clean, and far enough below
 * the real length that a rectangle drawn tight around the gauge still answers.
 */
const MIN_RULE = 24

/** How many rows apart the two rules may sit. The gauge's track is two rows; three is slack. */
const MIN_RULE_GAP = 2
const MAX_RULE_GAP = 4

/**
 * Whether a status gauge stands inside `rect` — two dark rules with a light track between them.
 *
 * `native` is the console's own pixels, the buffer `sampleNative` produces, because `rect` is in
 * the same native pixels `CaptureProfile.textRect` is: a gauge does not move when the emulator
 * window does.
 *
 * The track has to be *light*, not merely free of another rule. Without that, a solid dark block
 * would answer with its own top and bottom edges — which is the same class of mistake the colour
 * test made in the other direction.
 */
export function battleGaugeVisible(native: PixelBuffer, rect: PixelRect): boolean {
  const left = clamp(Math.floor(rect.x), native.width)
  const right = clamp(Math.floor(rect.x + rect.width), native.width)
  const top = clamp(Math.floor(rect.y), native.height)
  const bottom = clamp(Math.floor(rect.y + rect.height), native.height)
  if (right - left < MIN_RULE || bottom - top < MIN_RULE_GAP + 1) return false

  // One pass over the rows, so the pairing below is arithmetic on two small arrays rather than a
  // second walk of the pixels for every candidate pair.
  const rules: boolean[] = []
  const lit: number[] = []
  for (let y = top; y < bottom; y++) {
    const row = scanRow(native, y, left, right)
    rules.push(row.darkRun >= MIN_RULE)
    lit.push(row.lightPixels)
  }

  for (let a = 0; a < rules.length; a++) {
    if (!rules[a]) continue
    for (let b = a + MIN_RULE_GAP; b <= a + MAX_RULE_GAP && b < rules.length; b++) {
      if (!rules[b]) continue
      if (trackBetween(rules, lit, a, b)) return true
    }
  }
  return false
}

/** Whether every row strictly between two rules is track: no rule of its own, and mostly light. */
function trackBetween(rules: readonly boolean[], lit: readonly number[], a: number, b: number): boolean {
  for (let y = a + 1; y < b; y++) {
    // Half a rule's worth of light pixels. The real track is entirely light — bar plus white — so
    // this only has to be far enough from zero to reject the inside of a solid dark block.
    if (rules[y] || lit[y] * 2 < MIN_RULE) return false
  }
  return true
}

/** One row's longest dark run and how many of its pixels are not dark. */
function scanRow(
  native: PixelBuffer,
  y: number,
  left: number,
  right: number,
): { darkRun: number; lightPixels: number } {
  let darkRun = 0
  let run = 0
  let lightPixels = 0
  for (let x = left; x < right; x++) {
    if (isDark(native, x, y)) {
      run += 1
      if (run > darkRun) darkRun = run
    } else {
      run = 0
      lightPixels += 1
    }
  }
  return { darkRun, lightPixels }
}

function isDark(native: PixelBuffer, x: number, y: number): boolean {
  const offset = (y * native.width + x) * 4
  const data = native.data
  return (
    data[offset] < DARK_CEILING &&
    data[offset + 1] < DARK_CEILING &&
    data[offset + 2] < DARK_CEILING
  )
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(0, value))
}

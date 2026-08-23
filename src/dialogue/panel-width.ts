/**
 * The band the dialogue panel's dragged width lives in. Pure over two numbers — where the
 * available width comes from is the caller's problem, and keeping the DOM out is what makes
 * the bounds testable rather than eyeballed against a browser window.
 */

/** The narrowest the panel may become — the width its 40rem media query already gives it. */
export const MIN_PANEL_WIDTH = 224

/**
 * The floor on everything the panel is *not*. Measured against `.map-screen__body`, so above
 * 72rem this covers the 16rem sidebar and the canvas together, and below it — where the
 * sidebar floats over the canvas rather than sharing width with it, see `MapScreen.css` — the
 * whole floor is canvas. One number either way: what must never happen is the canvas being
 * dragged out of existence, and the sidebar scrolls on its own regardless.
 */
export const MIN_CANVAS_WIDTH = 640

/**
 * `width`, kept inside the band. When the window is too narrow to honour both floors the
 * panel's wins and the canvas's loses: a panel below `MIN_PANEL_WIDTH` cannot show the form
 * it exists for, while a squeezed canvas is still a canvas — and the user can always close
 * the panel, which is the one gesture that gives the canvas everything back.
 */
export function clampPanelWidth(width: number, availableWidth: number): number {
  const max = availableWidth - MIN_CANVAS_WIDTH
  if (max <= MIN_PANEL_WIDTH) return MIN_PANEL_WIDTH
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), max)
}

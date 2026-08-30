// Pure over two numbers — where availableWidth comes from is the caller's problem, keeping
// this testable rather than eyeballed against a browser window.
export const MIN_PANEL_WIDTH = 224

// Measured against .map-screen__body: above 72rem this covers the sidebar and canvas together;
// below it (sidebar floating over the canvas) the whole floor is canvas.
export const MIN_CANVAS_WIDTH = 640

// When the window can't honour both floors, the panel's wins — a squeezed canvas is still a
// canvas, and closing the panel gives it everything back.
export function clampPanelWidth(width: number, availableWidth: number): number {
  const max = availableWidth - MIN_CANVAS_WIDTH
  if (max <= MIN_PANEL_WIDTH) return MIN_PANEL_WIDTH
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), max)
}

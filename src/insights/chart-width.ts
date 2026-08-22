import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * The rendered width of an SVG chart, in real CSS pixels — not the viewBox width the markup
 * chooses. Every chart here is `width: 100%; height: auto` over a `viewBox`, so text drawn at a
 * literal `font-size` only paints at that size when the viewBox width matches the element's
 * actual rendered width; any other viewBox width scales the whole coordinate system, and the
 * text shrinks or grows with it. Feeding this measured width back in as the viewBox width is
 * what keeps the scale factor at exactly 1, so `font-size: 12px` is 12 real pixels regardless of
 * how the two-column layout squeezes the container.
 *
 * Falls back to `defaultWidth` until the element is measured (first paint, and any render before
 * the ref is attached), and tracks every later resize — the two-column/one-column breakpoint in
 * `InsightsScreen.css` changes this value without a page reload.
 */
export function useChartWidth<T extends Element>(defaultWidth: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(defaultWidth)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined && entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

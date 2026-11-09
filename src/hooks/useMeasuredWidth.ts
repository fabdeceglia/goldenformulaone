import { useEffect, useRef, useState } from 'react'

/**
 * The content width of an element, kept in sync with a `ResizeObserver`.
 * Hand-drawn SVG charts need a pixel width up front so their axes and labels
 * stay legible instead of scaling with a stretched `viewBox`.
 */
export function useMeasuredWidth<T extends HTMLElement>(initial = 640, min = 300) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(initial)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      const styles = window.getComputedStyle(element)
      const padding =
        (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0)
      setWidth(Math.max(min, element.clientWidth - padding))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [min])

  return { ref, width }
}

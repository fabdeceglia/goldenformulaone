import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query currently matches. Used where a layout change is
 * more than restyling — a phone drops the two schedule buttons entirely and
 * renders a menu instead, so the choice has to be made in markup, not CSS.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    // The viewport can change between the first render and this effect.
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

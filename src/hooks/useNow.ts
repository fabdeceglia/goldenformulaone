import { useEffect, useState } from 'react'
import { clockFrozen, clockNow } from '../lib/clock'

/**
 * The current time, re-read on an interval so time-based UI — the live session
 * marker, the results button that appears once a session ends — keeps up
 * without a page reload.
 *
 * The clock stays frozen while the tab is hidden (browsers throttle timers in
 * the background), so it also refreshes the moment the tab comes back into
 * view rather than waiting out the interval. A development override (`?now=`)
 * stops the ticking entirely.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(clockNow)

  useEffect(() => {
    if (clockFrozen) return

    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, intervalMs)

    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs])

  return now
}

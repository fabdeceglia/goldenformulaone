/**
 * Development-only clock override.
 *
 * Visiting the app with `?now=2026-10-25T20:30:00Z` freezes it on that instant,
 * which makes it possible to review a race weekend — live sessions, the results
 * button, the "race complete" state — without waiting for the calendar. The
 * override is compiled out of production builds: `import.meta.env.DEV` is false
 * there, so the parameter does nothing.
 */
const OVERRIDE: number | null = readOverride()

function readOverride(): number | null {
  if (!import.meta.env.DEV) return null

  const value = new URLSearchParams(window.location.search).get('now')
  if (!value) return null

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/** The current time, or the frozen development instant when one is set. */
export function clockNow(): number {
  return OVERRIDE ?? Date.now()
}

/** Whether the development override is driving the app. */
export const clockFrozen = OVERRIDE !== null

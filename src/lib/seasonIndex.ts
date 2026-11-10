/**
 * Step through the standings list with wrap-around, so the last Next returns to
 * the first entry and the first Previous goes to the last. `null` means the
 * dialog is closed.
 */
export function stepSeasonIndex(
  current: number | null,
  delta: number,
  total: number,
): number | null {
  if (current === null || total === 0) return current
  return (current + delta + total) % total
}

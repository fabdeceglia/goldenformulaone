import type { AlphaSessionEntry, AlphaSessionResults } from '../api/types'
import { QUALIFYING_SEGMENTS } from '../shared/openf1Map'
import { formatGap, parseSessionTime } from './format'

export { QUALIFYING_SEGMENTS }

/**
 * The Starting Grid is a second reading of a qualifying classification — the same
 * payload the table renders, laid out the way the cars line up. Everything it
 * needs is derived here so the component stays presentational and this stays
 * testable without a DOM.
 */

/**
 * The segments each qualifying session runs, in order. This is also the column
 * list the qualifying table uses, so the two views cannot drift apart. It lives
 * in the shared OpenF1 mapper so the Worker sees the same list.
 */

/** One car on the grid, with everything a plate needs already worked out. */
export interface GridEntry {
  entry: AlphaSessionEntry
  /** One flag per segment: did this car set a time in it? */
  segments: boolean[]
  /** Gap to pole, e.g. "+0.149". Null for the pole itself and for no time. */
  gap: string | null
}

export interface GridLayout {
  /**
   * Cars that line up, in classification order. The slot is the array index:
   * the grid is renumbered, because a car that was excluded moves everyone
   * behind it up a place, and the API's own positions leave the gap behind.
   */
  grid: GridEntry[]
  /** Cars with no time: ordered by the API, but not on the grid. */
  unclassified: GridEntry[]
  /** Segment codes for this session, e.g. `['Q1', 'Q2', 'Q3']`. */
  segments: readonly string[]
}

/**
 * A car that set no time. The API marks it with `NC` and `is_classified: false`;
 * either signal is enough, so a payload carrying only one of them still works.
 */
function isUnclassified(entry: AlphaSessionEntry): boolean {
  if (entry.position_text.toUpperCase() === 'NC') return true
  return entry.is_classified === false
}

/** The API's ordering, with anything unnumbered pushed to the back. */
function byPosition(a: AlphaSessionEntry, b: AlphaSessionEntry): number {
  const left = Number.isFinite(a.position) ? a.position : Number.MAX_SAFE_INTEGER
  const right = Number.isFinite(b.position) ? b.position : Number.MAX_SAFE_INTEGER
  return left - right
}

/** Gap to the pole time, e.g. "+0.149"; null for the pole itself. */
export function gapToPole(entry: AlphaSessionEntry, poleMillis: number | null): string | null {
  const millis = parseSessionTime(entry.time)
  if (millis === null || poleMillis === null || millis <= poleMillis) return null
  return formatGap(millis, poleMillis)
}

/** Which segments a car set a time in, as flags in segment order. */
export function segmentParticipation(
  entry: AlphaSessionEntry,
  segments: readonly string[],
): boolean[] {
  return segments.map((segment) => Boolean(entry.components?.[segment]?.time))
}

/**
 * A qualifying classification, split into the rows that make the grid and any
 * car that did not set a time. Not every classified entry lines up — the API
 * orders an `NC` car with the rest — so it is pulled out to sit behind the rows
 * that will actually take the start.
 */
export function gridRows(session: AlphaSessionResults): GridLayout {
  const segments = QUALIFYING_SEGMENTS[session.code] ?? []

  const rows = [...session.results].sort(byPosition).map<GridEntry>((entry) => ({
    entry,
    segments: segmentParticipation(entry, segments),
    gap: null,
  }))

  const grid = rows.filter((row) => !isUnclassified(row.entry))
  const unclassified = rows.filter((row) => isUnclassified(row.entry))

  // Every gap is measured against the pole car, so the leader's own time is the
  // reference rather than a per-row pair.
  const poleMillis = parseSessionTime(grid[0]?.entry.time)

  return {
    grid: grid.map((row) => ({ ...row, gap: gapToPole(row.entry, poleMillis) })),
    unclassified,
    segments,
  }
}

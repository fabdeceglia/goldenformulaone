import type { QualifyingResult, RaceWithQualifying } from '../api/types'
import { outcomeFor, toNumber } from './driverSeason'
import type { DriverSeason } from './driverSeason'

/** Four series are the most a single radar can carry and stay readable. */
export const MAX_COMPARE_DRIVERS = 4

export type CompareAxisId = 'wins' | 'poles' | 'qualifying' | 'fastestLaps' | 'finishes'

export interface CompareAxis {
  id: CompareAxisId
  /** Spoke label, one or two short lines so five of them fit around a radar. */
  spoke: readonly string[]
  /** What the axis counts, printed under the chart and on hover. */
  hint: string
}

/**
 * Every axis is a share of a sample, so more is always better and the five
 * spokes read the same way. Races and sessions differ per driver, so raw counts
 * belong in the table the dialog prints under the radar, not on the spokes.
 *
 * Retirements reach the radar as its inverse, `finishes`: a driver who retires
 * often loses area instead of gaining it, which is what a reader expects from a
 * chart where the outer ring is the strong end.
 */
export const COMPARE_AXES: readonly CompareAxis[] = [
  { id: 'wins', spoke: ['Wins'], hint: 'share of race starts won' },
  { id: 'poles', spoke: ['Poles'], hint: 'share of qualifying sessions taken' },
  {
    id: 'qualifying',
    spoke: ['Qualifying', 'vs team mate'],
    hint: 'qualifying sessions ahead of the team mate',
  },
  {
    id: 'fastestLaps',
    spoke: ['Fastest', 'laps'],
    hint: 'share of race starts with the fastest lap',
  },
  { id: 'finishes', spoke: ['Finishes'], hint: 'race starts classified at the flag' },
]

export interface HeadToHead {
  /** Sessions the driver out-qualified the team mate. */
  wins: number
  losses: number
}

export interface CompareCounts {
  /** Race entries, DNS included. */
  races: number
  /** Race starts: entries minus DNS. The denominator for the per-race shares. */
  starts: number
  wins: number
  poles: number
  fastestLaps: number
  retirements: number
  finishes: number
  /** Qualifying sessions the driver was classified in. */
  qualifyingSessions: number
  headToHeadWins: number
  headToHeadLosses: number
}

export interface DriverCompareStat {
  driverId: string
  counts: CompareCounts
  /** 0..1 per axis, or null when the driver has no sample for it. */
  values: Record<CompareAxisId, number | null>
}

/**
 * The season as the radar's five shares plus the raw counts behind them.
 *
 * `season.rounds` is the union of race and sprint weekends, so the race rows
 * are the ones carrying a classification; a sprint-only round has none.
 */
export function buildCompareStat(
  season: DriverSeason,
  headToHead: HeadToHead | null,
): DriverCompareStat {
  const raceRows = season.rounds.flatMap((round) =>
    round.positionText === null
      ? []
      : [{ round, outcome: outcomeFor(round.positionText, round.status) }],
  )

  // A DNS is an entry that never became a start, so it stays out of every rate.
  const starts = raceRows.filter((entry) => entry.outcome !== 'dns')
  const wins = starts.filter(
    (entry) => entry.outcome === 'finish' && entry.round.position === 1,
  ).length
  const finishes = starts.filter((entry) => entry.outcome === 'finish').length
  const fastestLaps = starts.filter((entry) => entry.round.fastestLap).length
  const retirements = raceRows.filter((entry) => entry.outcome === 'retired').length

  const qualifying = season.rounds.filter((round) => round.qualifyingPosition !== null)
  const poles = qualifying.filter((round) => round.qualifyingPosition === 1).length

  const headToHeadWins = headToHead?.wins ?? 0
  const headToHeadLosses = headToHead?.losses ?? 0
  const headToHeadSample = headToHeadWins + headToHeadLosses

  return {
    driverId: season.driverId,
    counts: {
      races: raceRows.length,
      starts: starts.length,
      wins,
      poles,
      fastestLaps,
      retirements,
      finishes,
      qualifyingSessions: qualifying.length,
      headToHeadWins,
      headToHeadLosses,
    },
    values: {
      wins: share(wins, starts.length),
      poles: share(poles, qualifying.length),
      qualifying: share(headToHeadWins, headToHeadSample),
      fastestLaps: share(fastestLaps, starts.length),
      finishes: share(finishes, starts.length),
    },
  }
}

/**
 * Qualifying record against the team mate, from the constructor endpoint, which
 * is the only one returning both cars for a session. Rounds where either car is
 * missing are dropped rather than guessed; a mid-season team change simply
 * contributes the sessions that driver actually contested for that team.
 */
export function buildHeadToHead(
  driverId: string,
  qualifyingRaces: readonly RaceWithQualifying[],
): HeadToHead {
  let wins = 0
  let losses = 0

  for (const race of qualifyingRaces) {
    const rows = race.QualifyingResults
    const own = rows.filter((row) => row.Driver.driverId === driverId)
    if (own.length === 0) continue

    const teamMates = rows.filter((row) => row.Driver.driverId !== driverId)
    const ownPosition = bestPosition(own)
    const teamMatePosition = bestPosition(teamMates)
    if (ownPosition === null || teamMatePosition === null) continue

    if (ownPosition < teamMatePosition) wins += 1
    else if (ownPosition > teamMatePosition) losses += 1
  }

  return { wins, losses }
}

/** A team's quickest car in a session, which is the one the driver is measured against. */
function bestPosition(rows: readonly QualifyingResult[]): number | null {
  const positions = rows
    .map((row) => toNumber(row.position))
    .filter((position): position is number => position !== null)
  return positions.length === 0 ? null : Math.min(...positions)
}

function share(count: number, sample: number): number | null {
  return sample > 0 ? count / sample : null
}

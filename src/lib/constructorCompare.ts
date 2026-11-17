import type { CompareAxis, CompareStat } from './compare'
import { share } from './compare'
import type { ConstructorSeason } from './constructorSeason'

export type ConstructorAxisId = 'wins' | 'poles' | 'podiums' | 'fastestLaps' | 'finishes'

/**
 * The team radar. Four of the five axes are shares of car starts, because a
 * constructor's season is its two cars, and that keeps the spokes comparable
 * with the driver chart's. The team-mate axis has no team equivalent, so it is
 * replaced by podiums; retirements arrive inverted as `finishes`, for the same
 * reason they do on the driver radar.
 */
export const CONSTRUCTOR_COMPARE_AXES: readonly CompareAxis<ConstructorAxisId>[] = [
  { id: 'wins', spoke: ['Wins'], hint: 'share of car starts won' },
  { id: 'poles', spoke: ['Poles'], hint: 'share of qualifying sessions taken' },
  { id: 'podiums', spoke: ['Podiums'], hint: 'share of car starts finished in the top three' },
  {
    id: 'fastestLaps',
    spoke: ['Fastest', 'laps'],
    hint: 'share of car starts with the fastest lap',
  },
  { id: 'finishes', spoke: ['Finishes'], hint: 'car starts classified at the flag' },
]

export interface ConstructorCompareCounts {
  /** Race entries, DNS included. */
  entries: number
  /** Race starts: entries minus DNS. The denominator for the car-share axes. */
  starts: number
  wins: number
  podiums: number
  poles: number
  fastestLaps: number
  finishes: number
  retirements: number
  qualifyingSessions: number
}

export interface ConstructorCompareStat extends CompareStat<
  Record<ConstructorAxisId, number | null>
> {
  constructorId: string
  counts: ConstructorCompareCounts
}

/**
 * The team season as the radar's five shares plus the counts behind them. A car
 * that failed to start is an entry, not a start, so every car-share axis uses
 * `starts` as its denominator.
 */
export function buildConstructorCompareStat(season: ConstructorSeason): ConstructorCompareStat {
  const { stats } = season
  const starts = stats.races - stats.dns
  // Every race row resolves to exactly one outcome, so the finishes are what is
  // left once the three non-finishes are taken out.
  const finishes = stats.races - stats.retirements - stats.dns - stats.dsq

  return {
    constructorId: season.constructorId,
    counts: {
      entries: stats.races,
      starts,
      wins: stats.wins,
      podiums: stats.podiums,
      poles: stats.poles,
      fastestLaps: stats.fastestLaps,
      finishes,
      retirements: stats.retirements,
      qualifyingSessions: stats.qualifyingSessions,
    },
    values: {
      wins: share(stats.wins, starts),
      poles: share(stats.poles, stats.qualifyingSessions),
      podiums: share(stats.podiums, starts),
      fastestLaps: share(stats.fastestLaps, starts),
      finishes: share(finishes, starts),
    },
  }
}

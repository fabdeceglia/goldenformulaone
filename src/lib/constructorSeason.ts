import type {
  QualifyingResult,
  RaceResult,
  RaceWithQualifying,
  RaceWithResults,
  RaceWithSprintResults,
} from '../api/types'
import { outcomeFor, toNumber } from './driverSeason'
import type { FinishOutcome } from './driverSeason'

export interface ConstructorRoundResult {
  round: number
  name: string
  /** Both cars, race only. */
  racePoints: number
  /** Both cars, sprint only. */
  sprintPoints: number
}

export interface ConstructorStats {
  /** Race entries, i.e. two per completed round, DNS included. */
  races: number
  /** Race wins across both cars; sprint wins are not counted here. */
  wins: number
  retirements: number
  dns: number
  dsq: number
  /** Mean car classification, excluding retirements, DNS and DSQ. */
  avgRace: number | null
  avgQualifying: number | null
  /** Denominators behind the two averages. */
  raceSample: number
  qualifyingSample: number
}

export interface ConstructorSeason {
  /** Ascending union of race and sprint rounds. */
  rounds: ConstructorRoundResult[]
  /** Cumulative points, indexed by position in `rounds`. */
  points: Array<{ index: number; round: number; value: number }>
  stats: ConstructorStats
}

/**
 * A constructor's season is the sum of its cars, so this reads the same
 * constructor-filtered results, sprint and qualifying endpoints as the driver
 * chart and aggregates both entries per round. Points are the only series the
 * dialog draws; the statistics add up wins, retirements and car positions.
 */
export function buildConstructorSeason(
  constructorId: string,
  raceRaces: readonly RaceWithResults[],
  sprintRaces: readonly RaceWithSprintResults[],
  qualifyingRaces: readonly RaceWithQualifying[],
): ConstructorSeason {
  const races = new Map<number, { name: string; rows: RaceResult[] }>()
  const sprints = new Map<number, { name: string; rows: RaceResult[] }>()
  const qualifying = new Map<number, { name: string; rows: QualifyingResult[] }>()

  for (const race of raceRaces) {
    const round = toNumber(race.round)
    if (round === null) continue
    const rows = race.Results.filter((row) => row.Constructor.constructorId === constructorId)
    if (rows.length > 0) races.set(round, { name: race.raceName, rows })
  }

  for (const race of sprintRaces) {
    const round = toNumber(race.round)
    if (round === null) continue
    const rows = race.SprintResults.filter((row) => row.Constructor.constructorId === constructorId)
    if (rows.length > 0) sprints.set(round, { name: race.raceName, rows })
  }

  for (const race of qualifyingRaces) {
    const round = toNumber(race.round)
    if (round === null) continue
    const rows = race.QualifyingResults.filter(
      (row) => row.Constructor.constructorId === constructorId,
    )
    if (rows.length > 0) qualifying.set(round, { name: race.raceName, rows })
  }

  const roundNumbers = [...new Set([...races.keys(), ...sprints.keys()])].sort((a, b) => a - b)

  const rounds: ConstructorRoundResult[] = roundNumbers.map((round) => {
    const race = races.get(round)
    const sprint = sprints.get(round)

    return {
      round,
      name: race?.name ?? sprint?.name ?? `Round ${round}`,
      racePoints: sumPoints(race?.rows ?? []),
      sprintPoints: sumPoints(sprint?.rows ?? []),
    }
  })

  let running = 0
  const points = rounds.map((entry, index) => {
    running += entry.racePoints + entry.sprintPoints
    return { index, round: entry.round, value: running }
  })

  return {
    rounds,
    points,
    stats: buildStats(races, qualifying),
  }
}

function buildStats(
  races: ReadonlyMap<number, { rows: RaceResult[] }>,
  qualifying: ReadonlyMap<number, { rows: QualifyingResult[] }>,
): ConstructorStats {
  const raceRows = [...races.values()].flatMap((entry) => entry.rows)
  const qualifyingRows = [...qualifying.values()].flatMap((entry) => entry.rows)
  const outcomes: FinishOutcome[] = raceRows.map((row) => outcomeFor(row.positionText, row.status))
  const count = (outcome: FinishOutcome) => outcomes.filter((value) => value === outcome).length

  // A classified retirement still carries a numeric position, so the average
  // keys off the outcome, exactly as the driver stats do.
  const classified = raceRows
    .filter((_, index) => outcomes[index] === 'finish')
    .map((row) => toNumber(row.position))
    .filter((value): value is number => value !== null)

  const qualifyingPositions = qualifyingRows
    .map((row) => toNumber(row.position))
    .filter((value): value is number => value !== null)

  return {
    races: raceRows.length,
    wins: raceRows.filter(
      (row, index) => outcomes[index] === 'finish' && toNumber(row.position) === 1,
    ).length,
    retirements: count('retired'),
    dns: count('dns'),
    dsq: count('dsq'),
    avgRace: mean(classified),
    avgQualifying: mean(qualifyingPositions),
    raceSample: classified.length,
    qualifyingSample: qualifyingPositions.length,
  }
}

function sumPoints(rows: readonly RaceResult[]): number {
  return rows.reduce((total, row) => total + (toNumber(row.points) ?? 0), 0)
}

/** One decimal, so a mean reads as `4.7` rather than a false-precision run of digits. */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round((total / values.length) * 10) / 10
}

import type {
  QualifyingResult,
  RaceResult,
  RaceWithQualifying,
  RaceWithResults,
  RaceWithSprintResults,
} from '../api/types'

/**
 * How Ergast classifies a race entry, read from `positionText` rather than the
 * free-text `status` (which changes wording from season to season).
 */
export type FinishOutcome = 'finish' | 'retired' | 'dsq' | 'dns'

export interface DriverRoundResult {
  round: number
  name: string
  /** Numeric classification, including a retirement's back-of-field slot. */
  position: number | null
  positionText: string | null
  status: string | null
  racePoints: number
  sprintPoints: number
  qualifyingPosition: number | null
}

export interface DriverSeason {
  /** Ascending union of race and sprint rounds. */
  rounds: DriverRoundResult[]
  /** Cumulative points, indexed by position in `rounds`. */
  points: Array<{ index: number; round: number; value: number }>
  /** Race classifications only, with the x index from `rounds`. */
  positions: Array<{
    index: number
    round: number
    value: number
    outcome: FinishOutcome
  }>
  stats: DriverStats
}

export interface DriverStats {
  /** Race rows, DNS included. */
  races: number
  /** Race wins only; sprint wins are not counted here. */
  wins: number
  retirements: number
  dns: number
  dsq: number
  /** Mean classification, excluding retirements, DNS and DSQ. */
  avgRace: number | null
  avgQualifying: number | null
  /** Denominators behind the two averages. */
  raceSample: number
  qualifyingSample: number
}

interface RoundEntry<T> {
  name: string
  row: T
}

/**
 * Turn the three per-driver responses into the series and statistics the dialog
 * draws. Pure, so the sprint/DNS/DSQ cases can be tested without the API.
 *
 * Each chart derives its own coverage: race results, sprint results and
 * qualifying can lag one another, and the standings round is no guide.
 */
export function buildDriverSeason(
  driverId: string,
  raceRaces: readonly RaceWithResults[],
  sprintRaces: readonly RaceWithSprintResults[],
  qualifyingRaces: readonly RaceWithQualifying[],
): DriverSeason {
  const races = new Map<number, RoundEntry<RaceResult>>()
  const sprints = new Map<number, RoundEntry<RaceResult>>()
  const qualifying = new Map<number, RoundEntry<QualifyingResult>>()

  for (const race of raceRaces) {
    const round = toNumber(race.round)
    if (round === null) continue
    const row = race.Results.find((entry) => entry.Driver.driverId === driverId)
    if (row) races.set(round, { name: race.raceName, row })
  }

  for (const race of sprintRaces) {
    const round = toNumber(race.round)
    if (round === null) continue
    const row = race.SprintResults.find((entry) => entry.Driver.driverId === driverId)
    if (row) sprints.set(round, { name: race.raceName, row })
  }

  for (const race of qualifyingRaces) {
    const round = toNumber(race.round)
    if (round === null) continue
    const row = race.QualifyingResults.find((entry) => entry.Driver.driverId === driverId)
    if (row) qualifying.set(round, { name: race.raceName, row })
  }

  const roundNumbers = [...new Set([...races.keys(), ...sprints.keys()])].sort((a, b) => a - b)

  const rounds: DriverRoundResult[] = roundNumbers.map((round) => {
    const race = races.get(round)
    const sprint = sprints.get(round)
    const quali = qualifying.get(round)

    return {
      round,
      name: race?.name ?? sprint?.name ?? `Round ${round}`,
      position: race ? toNumber(race.row.position) : null,
      positionText: race?.row.positionText ?? null,
      status: race?.row.status ?? null,
      racePoints: race ? (toNumber(race.row.points) ?? 0) : 0,
      sprintPoints: sprint ? (toNumber(sprint.row.points) ?? 0) : 0,
      qualifyingPosition: quali ? toNumber(quali.row.position) : null,
    }
  })

  let running = 0
  const points = rounds.map((entry, index) => {
    running += entry.racePoints + entry.sprintPoints
    return { index, round: entry.round, value: running }
  })

  const positions: DriverSeason['positions'] = []
  rounds.forEach((entry, index) => {
    if (entry.position === null || entry.positionText === null) return
    positions.push({
      index,
      round: entry.round,
      value: entry.position,
      outcome: outcomeFor(entry.positionText, entry.status),
    })
  })

  return {
    rounds,
    points,
    positions,
    stats: buildStats(races, qualifying),
  }
}

function buildStats(
  races: ReadonlyMap<number, RoundEntry<RaceResult>>,
  qualifying: ReadonlyMap<number, RoundEntry<QualifyingResult>>,
): DriverStats {
  const raceRows = [...races.values()].map((entry) => entry.row)
  const qualifyingRows = [...qualifying.values()].map((entry) => entry.row)
  const outcomes = raceRows.map((row) => outcomeFor(row.positionText, row.status))
  const count = (outcome: FinishOutcome) => outcomes.filter((value) => value === outcome).length

  // A classified retirement still carries a numeric position, so the average
  // must key off the outcome rather than the shape of `positionText`.
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

/** Statuses that mean the car reached the flag. Everything else is a non-finish. */
const FINISH_STATUSES = new Set(['Finished', 'Lapped'])

const DSQ_STATUSES = new Set(['Disqualified', 'Excluded', 'Underweight'])

const DNS_STATUSES = new Set(['Did not start', 'Did not qualify', 'Withdrew', 'Safety concerns'])

/**
 * Ergast marks an unclassified retirement with `positionText` `R`, but a car
 * that completed 90% of the distance is classified with a numeric position and
 * a retirement `status` (e.g. `16` / `Retired`). Read both: the explicit R/D/W
 * marker first, then the status. Finish statuses are the stable short list;
 * retirement reasons are free text and deliberately not enumerated.
 */
function outcomeFor(positionText: string, status: string | null | undefined): FinishOutcome {
  if (positionText === 'R') return 'retired'
  if (positionText === 'D') return 'dsq'
  if (positionText === 'W') return 'dns'
  if (!status) return 'finish'
  if (FINISH_STATUSES.has(status) || /^\+\d+ Laps?$/.test(status)) return 'finish'
  if (DSQ_STATUSES.has(status)) return 'dsq'
  if (DNS_STATUSES.has(status)) return 'dns'
  return 'retired'
}

/** Ergast sends every numeric field as a string; a blank one is missing, not zero. */
function toNumber(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** One decimal, so a mean reads as `4.7` rather than a false-precision run of digits. */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round((total / values.length) * 10) / 10
}

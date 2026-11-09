import { describe, expect, it } from 'vitest'
import type {
  Constructor,
  Driver,
  QualifyingResult,
  RaceResult,
  RaceWithQualifying,
  RaceWithResults,
  RaceWithSprintResults,
} from '../api/types'
import { buildDriverSeason } from './driverSeason'

const DRIVER_ID = 'verstappen'

function driver(id = DRIVER_ID): Driver {
  return {
    driverId: id,
    permanentNumber: '1',
    code: 'VER',
    url: '',
    givenName: 'Max',
    familyName: 'Verstappen',
    dateOfBirth: '1997-09-30',
    nationality: 'Dutch',
  }
}

function constructor(): Constructor {
  return { constructorId: 'red_bull', url: '', name: 'Red Bull', nationality: 'Austrian' }
}

function race(round: number) {
  return {
    season: '2026',
    round: String(round),
    url: '',
    raceName: `Round ${round}`,
    Circuit: {
      circuitId: 'circuit',
      url: '',
      circuitName: 'Circuit',
      Location: { lat: '0', long: '0', locality: 'Town', country: 'Country' },
    },
    date: '2026-01-01',
  }
}

function result(
  position: number,
  positionText: string,
  points: number,
  id = DRIVER_ID,
): RaceResult {
  return {
    number: '1',
    position: String(position),
    positionText,
    points: String(points),
    Driver: driver(id),
    Constructor: constructor(),
    grid: '1',
    laps: '50',
    status: positionText === 'R' ? 'Retired' : 'Finished',
  }
}

function raceWith(round: number, results: RaceResult[]): RaceWithResults {
  return { ...race(round), Results: results }
}

function sprintWith(round: number, results: RaceResult[]): RaceWithSprintResults {
  return { ...race(round), SprintResults: results }
}

function qualifyingWith(round: number, position: number): RaceWithQualifying {
  const row: QualifyingResult = {
    number: '1',
    position: String(position),
    Driver: driver(),
    Constructor: constructor(),
  }
  return { ...race(round), QualifyingResults: [row] }
}

describe('buildDriverSeason', () => {
  it('accumulates race and sprint points over the union of rounds', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [
        raceWith(1, [result(1, '1', 25)]),
        raceWith(2, [result(2, '2', 18)]),
        raceWith(3, [result(3, '3', 15)]),
      ],
      [sprintWith(2, [result(1, '1', 8)])],
      [],
    )

    expect(season.rounds.map((entry) => entry.round)).toEqual([1, 2, 3])
    expect(season.points.map((entry) => entry.value)).toEqual([25, 51, 66])
    expect(season.stats.wins).toBe(1)
    expect(season.stats.races).toBe(3)
  })

  it('keeps a sprint-only round in the points series but not the positions', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [raceWith(1, [result(1, '1', 25)])],
      [sprintWith(2, [result(4, '4', 5)])],
      [],
    )

    expect(season.rounds.map((entry) => entry.round)).toEqual([1, 2])
    expect(season.points.map((entry) => entry.value)).toEqual([25, 30])
    expect(season.positions).toEqual([{ index: 0, round: 1, value: 1, outcome: 'finish' }])
  })

  it('marks a retirement from positionText and leaves it out of the average', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [
        raceWith(1, [result(1, '1', 25)]),
        raceWith(2, [result(20, 'R', 0)]),
        raceWith(3, [result(5, '5', 10)]),
      ],
      [],
      [],
    )

    expect(season.positions.map((entry) => entry.outcome)).toEqual(['finish', 'retired', 'finish'])
    expect(season.stats.retirements).toBe(1)
    expect(season.stats.avgRace).toBe(3)
    expect(season.stats.raceSample).toBe(2)
  })

  it('counts a classified retirement whose positionText is numeric', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [
        raceWith(1, [result(1, '1', 25)]),
        raceWith(2, [{ ...result(16, '16', 0), status: 'Retired' }]),
        raceWith(3, [result(5, '5', 10)]),
      ],
      [],
      [],
    )

    expect(season.positions.map((entry) => entry.outcome)).toEqual(['finish', 'retired', 'finish'])
    expect(season.stats.retirements).toBe(1)
    expect(season.stats.avgRace).toBe(3)
    expect(season.stats.raceSample).toBe(2)
  })

  it('keeps a lapped finisher in the average', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [
        raceWith(1, [result(1, '1', 25)]),
        raceWith(2, [{ ...result(14, '14', 0), status: 'Lapped' }]),
      ],
      [],
      [],
    )

    expect(season.positions.map((entry) => entry.outcome)).toEqual(['finish', 'finish'])
    expect(season.stats.avgRace).toBe(7.5)
    expect(season.stats.raceSample).toBe(2)
  })

  it('counts DNS and DSQ without treating either as a retirement', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [
        raceWith(1, [result(21, 'W', 0)]),
        raceWith(2, [result(22, 'D', 0)]),
        raceWith(3, [result(3, '3', 15)]),
      ],
      [],
      [],
    )

    expect(season.stats.dns).toBe(1)
    expect(season.stats.dsq).toBe(1)
    expect(season.stats.retirements).toBe(0)
    expect(season.stats.avgRace).toBe(3)
    expect(season.stats.raceSample).toBe(1)
    expect(season.positions.map((entry) => entry.outcome)).toEqual(['dns', 'dsq', 'finish'])
  })

  it('uses an event index rather than the raw round number', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [raceWith(1, [result(2, '2', 18)]), raceWith(3, [result(1, '1', 25)])],
      [],
      [],
    )

    expect(season.points.map((entry) => entry.index)).toEqual([0, 1])
    expect(season.points.map((entry) => entry.round)).toEqual([1, 3])
    expect(season.positions.map((entry) => entry.index)).toEqual([0, 1])
  })

  it('derives each chart from its own coverage', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [raceWith(1, [result(1, '1', 25)]), raceWith(2, [result(2, '2', 18)])],
      [],
      [qualifyingWith(1, 2), qualifyingWith(2, 1), qualifyingWith(3, 4)],
    )

    expect(season.rounds.map((entry) => entry.round)).toEqual([1, 2])
    expect(season.rounds[1].qualifyingPosition).toBe(1)
    expect(season.stats.qualifyingSample).toBe(3)
    expect(season.stats.avgQualifying).toBe(2.3)
  })

  it('uses a missing qualifying round as no data, not zero', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [raceWith(1, [result(1, '1', 25)]), raceWith(2, [result(2, '2', 18)])],
      [],
      [qualifyingWith(1, 2), qualifyingWith(2, 6)],
    )

    expect(season.stats.qualifyingSample).toBe(2)
    expect(season.stats.avgQualifying).toBe(4)
  })

  it('ignores rows belonging to another driver', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [raceWith(1, [result(1, '1', 25, 'someone_else')])],
      [],
      [],
    )

    expect(season.rounds).toEqual([])
    expect(season.points).toEqual([])
    expect(season.stats.races).toBe(0)
    expect(season.stats.avgRace).toBeNull()
    expect(season.stats.avgQualifying).toBeNull()
  })
})

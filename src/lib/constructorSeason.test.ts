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
import { buildConstructorSeason } from './constructorSeason'

const TEAM = 'mercedes'

function driver(id: string): Driver {
  return {
    driverId: id,
    url: '',
    givenName: id,
    familyName: 'Driver',
    dateOfBirth: '2000-01-01',
    nationality: 'Italian',
  }
}

function constructor(id = TEAM): Constructor {
  return { constructorId: id, url: '', name: 'Mercedes', nationality: 'German' }
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
  id: string,
  position: number,
  positionText: string,
  points: number,
  team = TEAM,
): RaceResult {
  return {
    number: '1',
    position: String(position),
    positionText,
    points: String(points),
    Driver: driver(id),
    Constructor: constructor(team),
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

function qualifyingWith(round: number, positions: number[]): RaceWithQualifying {
  const rows: QualifyingResult[] = positions.map((position, index) => ({
    number: '1',
    position: String(position),
    Driver: driver(`driver_${index}`),
    Constructor: constructor(),
  }))
  return { ...race(round), QualifyingResults: rows }
}

describe('buildConstructorSeason', () => {
  it('sums both cars and both sessions into the cumulative points series', () => {
    const season = buildConstructorSeason(
      TEAM,
      [
        raceWith(1, [result('a', 1, '1', 25), result('b', 2, '2', 18)]),
        raceWith(2, [result('a', 3, '3', 15), result('b', 4, '4', 12)]),
      ],
      [sprintWith(2, [result('a', 1, '1', 8), result('b', 5, '5', 4)])],
      [],
    )

    expect(season.rounds.map((entry) => entry.round)).toEqual([1, 2])
    expect(season.rounds[1]).toMatchObject({ racePoints: 27, sprintPoints: 12 })
    expect(season.points.map((entry) => entry.value)).toEqual([43, 82])
  })

  it('keeps a sprint-only round and names it from the sprint payload', () => {
    const season = buildConstructorSeason(
      TEAM,
      [raceWith(1, [result('a', 1, '1', 25), result('b', 2, '2', 18)])],
      [sprintWith(2, [result('a', 4, '4', 5), result('b', 6, '6', 3)])],
      [],
    )

    expect(season.rounds.map((entry) => entry.round)).toEqual([1, 2])
    expect(season.rounds[1].name).toBe('Round 2')
    expect(season.points.map((entry) => entry.value)).toEqual([43, 51])
  })

  it('counts wins per car and retirements across both cars', () => {
    const season = buildConstructorSeason(
      TEAM,
      [
        raceWith(1, [result('a', 1, '1', 25), result('b', 20, 'R', 0)]),
        raceWith(2, [result('a', 2, '2', 18), result('b', 3, '3', 15)]),
      ],
      [],
      [],
    )

    expect(season.stats.wins).toBe(1)
    expect(season.stats.retirements).toBe(1)
    expect(season.stats.races).toBe(4)
  })

  it('averages classifications over both cars, excluding retirements', () => {
    const season = buildConstructorSeason(
      TEAM,
      [
        raceWith(1, [result('a', 1, '1', 25), result('b', 5, '5', 10)]),
        raceWith(2, [result('a', 3, '3', 15), result('b', 20, 'R', 0)]),
      ],
      [],
      [qualifyingWith(1, [2, 6]), qualifyingWith(2, [1, 4])],
    )

    // 1, 5 and 3 count; the retirement does not.
    expect(season.stats.avgRace).toBe(3)
    expect(season.stats.raceSample).toBe(3)
    // Qualifying covers every car entry: 2, 6, 1, 4.
    expect(season.stats.avgQualifying).toBe(3.3)
    expect(season.stats.qualifyingSample).toBe(4)
  })

  it('ignores rows belonging to another constructor', () => {
    const season = buildConstructorSeason(
      TEAM,
      [raceWith(1, [result('a', 1, '1', 25, 'ferrari'), result('b', 2, '2', 18, 'ferrari')])],
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

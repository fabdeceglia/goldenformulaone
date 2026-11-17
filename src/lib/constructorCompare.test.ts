import { describe, expect, it } from 'vitest'
import type {
  Constructor,
  Driver,
  QualifyingResult,
  RaceResult,
  RaceWithQualifying,
  RaceWithResults,
} from '../api/types'
import { buildConstructorCompareStat } from './constructorCompare'
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
  fastestLap = false,
): RaceResult {
  return {
    number: '1',
    position: String(position),
    positionText,
    points: '0',
    Driver: driver(id),
    Constructor: constructor(),
    grid: '1',
    laps: '50',
    status: positionText === 'R' ? 'Retired' : 'Finished',
    ...(fastestLap ? { FastestLap: { rank: '1' } } : {}),
  }
}

function raceWith(round: number, results: RaceResult[]): RaceWithResults {
  return { ...race(round), Results: results }
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

describe('buildConstructorCompareStat', () => {
  it('turns both cars into the five shares, DNS out of the denominators', () => {
    const season = buildConstructorSeason(
      TEAM,
      [
        raceWith(1, [result('a', 1, '1', true), result('b', 2, '2')]),
        raceWith(2, [result('a', 3, '3'), result('b', 20, 'R')]),
        // A DNS is an entry, not a start: two cars entered, one started.
        raceWith(3, [result('a', 5, '5'), result('b', 21, 'W')]),
      ],
      [],
      [qualifyingWith(1, [1, 4]), qualifyingWith(2, [2, 5]), qualifyingWith(3, [3, 6])],
    )

    const stat = buildConstructorCompareStat(season)

    expect(stat.counts).toEqual({
      entries: 6,
      starts: 5,
      wins: 1,
      podiums: 3,
      poles: 1,
      fastestLaps: 1,
      finishes: 4,
      retirements: 1,
      qualifyingSessions: 3,
    })
    expect(stat.values.wins).toBeCloseTo(1 / 5)
    expect(stat.values.poles).toBeCloseTo(1 / 3)
    expect(stat.values.podiums).toBeCloseTo(3 / 5)
    expect(stat.values.fastestLaps).toBeCloseTo(1 / 5)
    expect(stat.values.finishes).toBeCloseTo(4 / 5)
  })

  it('reports no share for an axis with no sample', () => {
    const season = buildConstructorSeason(TEAM, [], [], [])

    const stat = buildConstructorCompareStat(season)

    expect(stat.values).toEqual({
      wins: null,
      poles: null,
      podiums: null,
      fastestLaps: null,
      finishes: null,
    })
  })
})

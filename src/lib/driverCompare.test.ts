import { describe, expect, it } from 'vitest'
import type {
  Constructor,
  Driver,
  QualifyingResult,
  RaceResult,
  RaceWithQualifying,
  RaceWithResults,
} from '../api/types'
import { buildCompareStat, buildHeadToHead } from './driverCompare'
import { buildDriverSeason } from './driverSeason'

const DRIVER_ID = 'verstappen'
const TEAM_MATE_ID = 'perez'

function driver(id = DRIVER_ID): Driver {
  return {
    driverId: id,
    permanentNumber: '1',
    code: id === DRIVER_ID ? 'VER' : 'PER',
    url: '',
    givenName: 'Max',
    familyName: 'Verstappen',
    dateOfBirth: '1997-09-30',
    nationality: 'Dutch',
  }
}

function constructor(id = 'red_bull'): Constructor {
  return { constructorId: id, url: '', name: 'Red Bull', nationality: 'Austrian' }
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

function result(position: number, positionText: string, fastestLap = false): RaceResult {
  return {
    number: '1',
    position: String(position),
    positionText,
    points: '0',
    Driver: driver(),
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

function qualifyingWith(round: number, rows: Array<[string, number]>): RaceWithQualifying {
  return {
    ...race(round),
    QualifyingResults: rows.map(([driverId, position]): QualifyingResult => ({
      number: '1',
      position: String(position),
      Driver: driver(driverId),
      Constructor: constructor(),
    })),
  }
}

describe('buildCompareStat', () => {
  it('turns a season into the five shares, with DNS out of the denominators', () => {
    const season = buildDriverSeason(
      DRIVER_ID,
      [
        raceWith(1, [result(1, '1', true)]),
        raceWith(2, [result(3, '3')]),
        raceWith(3, [result(20, 'R')]),
        raceWith(4, [result(21, 'W')]),
      ],
      [],
      [
        qualifyingWith(1, [[DRIVER_ID, 1]]),
        qualifyingWith(2, [[DRIVER_ID, 4]]),
        qualifyingWith(3, [[DRIVER_ID, 2]]),
      ],
    )

    const stat = buildCompareStat(season, { wins: 2, losses: 1 })

    expect(stat.counts).toEqual({
      races: 4,
      // The DNS is an entry, not a start, so the three rates below divide by 3.
      starts: 3,
      wins: 1,
      poles: 1,
      fastestLaps: 1,
      retirements: 1,
      finishes: 2,
      qualifyingSessions: 3,
      headToHeadWins: 2,
      headToHeadLosses: 1,
    })
    expect(stat.values.wins).toBeCloseTo(1 / 3)
    expect(stat.values.poles).toBeCloseTo(1 / 3)
    expect(stat.values.fastestLaps).toBeCloseTo(1 / 3)
    expect(stat.values.finishes).toBeCloseTo(2 / 3)
    expect(stat.values.qualifying).toBeCloseTo(2 / 3)
  })

  it('reports no share for an axis the driver has no sample for', () => {
    const season = buildDriverSeason(DRIVER_ID, [], [], [])

    const stat = buildCompareStat(season, null)

    expect(stat.values).toEqual({
      wins: null,
      poles: null,
      qualifying: null,
      fastestLaps: null,
      finishes: null,
    })
  })
})

describe('buildHeadToHead', () => {
  it('counts sessions ahead of and behind the other car', () => {
    const headToHead = buildHeadToHead(DRIVER_ID, [
      qualifyingWith(1, [
        [DRIVER_ID, 1],
        [TEAM_MATE_ID, 2],
      ]),
      qualifyingWith(2, [
        [DRIVER_ID, 5],
        [TEAM_MATE_ID, 3],
      ]),
      qualifyingWith(3, [
        [DRIVER_ID, 4],
        [TEAM_MATE_ID, 9],
      ]),
    ])

    expect(headToHead).toEqual({ wins: 2, losses: 1 })
  })

  it('ignores rounds the driver did not contest for this team', () => {
    const headToHead = buildHeadToHead(DRIVER_ID, [
      qualifyingWith(1, [[TEAM_MATE_ID, 1]]),
      qualifyingWith(2, [[TEAM_MATE_ID, 2]]),
    ])

    expect(headToHead).toEqual({ wins: 0, losses: 0 })
  })
})

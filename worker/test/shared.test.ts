import { describe, expect, it } from 'vitest'
import { unwrapAlpha } from '../../src/shared/alpha'
import {
  assessCompleteness,
  classificationHash,
  isCachedResult,
  resultStateRank,
} from '../../src/shared/results'
import {
  mapOpenF1Results,
  rawCompleteness,
  type OpenF1DriverRow,
  type OpenF1ResultRow,
} from '../../src/shared/openf1Map'
import {
  SESSION_MINUTES,
  raceSchedule,
  sessionEnd,
  sessionStart,
  sessionWindows,
} from '../../src/shared/schedule'
import { makeCached, makeRace, makeSessionResults, makeSprintRace } from './fixtures'

describe('unwrapAlpha', () => {
  it('returns a bare payload unchanged', () => {
    const payload = [{ id: 'round_1' }]
    expect(unwrapAlpha(payload)).toBe(payload)
  })

  it('unwraps the metadata envelope', () => {
    const data = { code: 'Q', results: [] }
    expect(
      unwrapAlpha({ metadata: { timestamp: '2026-01-01T00:00:00Z' }, data }),
    ).toBe(data)
  })

  it('leaves an object with data but no metadata alone', () => {
    const payload = { data: 'keep-me' }
    expect(unwrapAlpha(payload as unknown as { metadata: unknown; data: string })).toBe(payload)
  })
})

const DRIVERS: OpenF1DriverRow[] = [
  {
    driver_number: 1,
    full_name: 'Max Verstappen',
    name_acronym: 'VER',
    team_name: 'Red Bull Racing',
    team_colour: '1E41FF',
  },
  {
    driver_number: 2,
    full_name: 'Lando Norris',
    name_acronym: 'NOR',
    team_name: 'McLaren',
    team_colour: 'FF8700',
  },
  {
    driver_number: 3,
    full_name: 'Charles Leclerc',
    name_acronym: 'LEC',
    team_name: 'Ferrari',
    team_colour: 'E80020',
  },
]

describe('mapOpenF1Results', () => {
  it('maps a practice classification and formats decimal seconds', () => {
    const rows: OpenF1ResultRow[] = [
      { driver_number: 1, position: 1, duration: 77.565, number_of_laps: 20 },
      { driver_number: 2, position: 2, duration: 78.1, number_of_laps: 19 },
    ]

    const session = mapOpenF1Results(rows, {
      code: 'FP1',
      timestamp: '2026-10-23T17:30:00Z',
      round: { id: 'round_test', number: 18, name: 'Test GP' },
      drivers: DRIVERS,
    })

    expect(session.code).toBe('FP1')
    expect(session.results).toHaveLength(2)
    expect(session.results[0].time).toBe('1:17.565')
    expect(session.results[0].position_text).toBe('1')
    expect(session.results[0].team.primary_color).toBe('#1E41FF')
    expect(session.component_keys).toBeUndefined()
  })

  it('maps qualifying durations to the same Q1/Q2/Q3 components the grid uses', () => {
    const rows: OpenF1ResultRow[] = [
      { driver_number: 1, position: 1, duration: [77.1, 76.2, 75.3] },
      { driver_number: 2, position: 2, duration: [77.5, 76.8, null] },
    ]

    const session = mapOpenF1Results(rows, {
      code: 'Q',
      timestamp: '2026-10-24T21:00:00Z',
      round: { id: 'round_test', number: 18, name: 'Test GP' },
      drivers: DRIVERS,
    })

    expect(session.component_keys).toEqual(['Q1', 'Q2', 'Q3'])
    expect(session.results[0].time).toBe('1:15.300')
    expect(Object.keys(session.results[0].components ?? {})).toEqual(['Q1', 'Q2', 'Q3'])
    expect(session.results[0].components?.Q3.name).toBe('Qualifying 3')
    expect(session.results[1].components?.Q3).toBeUndefined()
    expect(session.results[1].time).toBe('1:16.800')
  })

  it('adds the grid component to a race and keeps retirements unclassified', () => {
    const rows: OpenF1ResultRow[] = [
      { driver_number: 1, position: 1, duration: 5400.5, points: 25, number_of_laps: 56 },
      { driver_number: 3, position: null, dnf: true, number_of_laps: 12 },
    ]

    const session = mapOpenF1Results(rows, {
      code: 'R',
      timestamp: '2026-10-25T20:00:00Z',
      round: { id: 'round_test', number: 18, name: 'Test GP' },
      drivers: DRIVERS,
      gridByDriver: new Map([[1, 3]]),
    })

    expect(session.component_keys).toEqual(['GRID'])
    expect(session.results[0].components?.GRID.position).toBe(3)
    expect(session.results[0].status).toBe('FINISHED')
    expect(session.results[0].points).toBe(25)

    const retired = session.results.find((row) => row.driver.id === '3')
    expect(retired?.position_text).toBe('NC')
    expect(retired?.is_classified).toBe(false)
    expect(retired?.status).toBe('RETIRED')
  })
})

describe('completeness', () => {
  it('counts raw positions and retirements, not mapped sentinels', () => {
    const rows: OpenF1ResultRow[] = [
      { driver_number: 1, position: 1 },
      { driver_number: 2, position: 2 },
      { driver_number: 3, position: null, dnf: true },
      { driver_number: 4, position: null, dns: true },
    ]

    expect(rawCompleteness(rows)).toEqual({
      drivers: 4,
      positioned: 2,
      classified: 2,
      hasWinner: true,
    })
  })

  it('requires the expected field size and a real position', () => {
    const counts = { drivers: 19, positioned: 19, classified: 19, hasWinner: true }

    expect(assessCompleteness(counts, 20, 'Q')).toEqual({ count: 19, complete: true })
    expect(assessCompleteness({ ...counts, drivers: 18 }, 20, 'Q').complete).toBe(false)
    expect(assessCompleteness({ ...counts, positioned: 0 }, 20, 'Q').complete).toBe(false)
  })

  it('requires a winner and a finisher for races and sprints', () => {
    const noWinner = { drivers: 20, positioned: 20, classified: 20, hasWinner: false }
    expect(assessCompleteness(noWinner, 20, 'R').complete).toBe(false)
    expect(assessCompleteness(noWinner, 20, 'Q').complete).toBe(true)

    const noFinisher = { drivers: 20, positioned: 20, classified: 0, hasWinner: true }
    expect(assessCompleteness(noFinisher, 20, 'SR').complete).toBe(false)
  })
})

describe('session windows', () => {
  it('computes every window in UTC and keeps the running order', () => {
    const windows = sessionWindows(makeRace())

    expect(windows.map((window) => window.entry.code)).toEqual([
      'FP1',
      'FP2',
      'FP3',
      'Q',
      'R',
    ])
    expect(windows.map((window) => window.entry.label)).toEqual([
      'Practice 1',
      'Practice 2',
      'Practice 3',
      'Qualifying',
      'Race',
    ])
    expect(windows[0].start).toBe(Date.parse('2026-10-23T17:30:00Z'))
    expect(windows[0].end).toBe(
      Date.parse('2026-10-23T17:30:00Z') + SESSION_MINUTES.FP1 * 60_000,
    )
    expect(windows[4].end).toBe(
      Date.parse('2026-10-25T20:00:00Z') + SESSION_MINUTES.R * 60_000,
    )
  })

  it('maps sprint weekend sessions by key rather than by position', () => {
    expect(raceSchedule(makeSprintRace()).map((entry) => entry.code)).toEqual([
      'FP1',
      'SQ',
      'SR',
      'Q',
      'R',
    ])
  })

  it('keeps start and end helpers consistent', () => {
    const start = sessionStart('2026-10-24', '21:00:00Z')
    expect(start).toBe(Date.parse('2026-10-24T21:00:00Z'))
    expect(sessionEnd(start, 'R') - start).toBe(120 * 60_000)
  })
})

describe('classification hash and state rank', () => {
  it('is stable when only the row order changes', () => {
    const rows = makeSessionResults('Q', 3).results
    const reversed = makeSessionResults('Q', 3, { results: [...rows].reverse() })

    expect(classificationHash({ ...makeSessionResults('Q'), results: rows })).toBe(
      classificationHash(reversed),
    )
    expect(classificationHash(null)).toBe('')
  })

  it('changes when a classification is amended', () => {
    const base = makeSessionResults('R', 2)
    const amended = makeSessionResults('R', 2, {
      results: base.results.map((row) =>
        row.position === 1 ? { ...row, position: 2, position_text: '2' } : row,
      ),
    })

    expect(classificationHash(base)).not.toBe(classificationHash(amended))
  })

  it('ranks states so a provisional result can never outrank final', () => {
    expect(resultStateRank('pending')).toBeLessThan(resultStateRank('provisional'))
    expect(resultStateRank('provisional')).toBeLessThan(resultStateRank('final'))
  })

  it('rejects a cached value written by an older version', () => {
    expect(isCachedResult(makeCached())).toBe(true)
    expect(isCachedResult({ ...makeCached(), v: 1 })).toBe(false)
    expect(isCachedResult({ ...makeCached(), code: 'XX' })).toBe(false)
  })
})

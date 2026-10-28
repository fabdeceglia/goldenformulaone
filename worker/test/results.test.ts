import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../src/cache'
import { ERROR_RETRY_MS, type Env } from '../src/config'
import { dueSessions, refreshSession, type RefreshContext } from '../src/results'
import type { SessionTarget } from '../src/schedule'
import type { OpenF1SessionRow } from '../src/sources/openf1'
import type { OpenF1DriverRow, OpenF1ResultRow } from '../../src/shared/openf1Map'
import type { Race, SessionCode } from '../../src/api/types'
import { sessionWindows } from '../../src/shared/schedule'
import { FakeKV, makeCached, makeRace, makeSessionResults } from './fixtures'

const DRIVERS: OpenF1DriverRow[] = [
  { driver_number: 1, full_name: 'Max Verstappen', name_acronym: 'VER', team_name: 'Red Bull', team_colour: '1E41FF' },
  { driver_number: 2, full_name: 'Lando Norris', name_acronym: 'NOR', team_name: 'McLaren', team_colour: 'FF8700' },
]

const OPENF1_SESSIONS: OpenF1SessionRow[] = [
  { session_key: 101, session_name: 'Practice 1', date_start: '2026-10-23T17:30:00Z' },
  { session_key: 102, session_name: 'Qualifying', date_start: '2026-10-24T21:00:00Z' },
  { session_key: 103, session_name: 'Race', date_start: '2026-10-25T20:00:00Z' },
]

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function failing(status: number, headers: Record<string, string> = {}): Response {
  return new Response('', { status, headers })
}

function makeContext(
  kv: FakeKV,
  races: Race[],
  now: number,
  sessions: OpenF1SessionRow[] = OPENF1_SESSIONS,
): RefreshContext {
  const env: Env = {
    RESULTS: kv as unknown as KVNamespace,
    JOLPICA_BASE: 'https://jolpica.test',
    OPENF1_BASE: 'https://openf1.test',
  }

  return {
    env,
    now,
    season: '2026',
    races,
    roundIds: { '18': 'round_test' },
    expectedDrivers: 2,
    options: { now },
    openF1Sessions: Promise.resolve(sessions),
  }
}

function targetFor(race: Race, code: SessionCode): SessionTarget {
  const window = sessionWindows(race).find((candidate) => candidate.entry.code === code)
  if (!window) throw new Error(`No window for ${code}`)
  return { season: '2026', round: race.round, code, race, window }
}

interface Stubs {
  jolpica?: (code: string) => Response
  openf1?: (url: string) => Response
}

function stubSources(stubs: Stubs) {
  const fn = vi.fn((input: unknown) => {
    const url = String(input)

    if (url.includes('/f1/alpha/results/')) {
      const code = url.split('/').filter(Boolean).pop() ?? ''
      return Promise.resolve(stubs.jolpica?.(code) ?? failing(404))
    }

    if (url.startsWith('https://openf1.test')) {
      return Promise.resolve(stubs.openf1?.(url) ?? json([]))
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`))
  })

  vi.stubGlobal('fetch', fn)
  return fn
}

function openF1Rows(code: SessionCode): OpenF1ResultRow[] {
  const duration =
    code === 'Q' || code === 'SQ'
      ? [
          [77.1, 76.2, 75.3],
          [77.5, 76.8, null],
        ]
      : [77.5, 78.1]

  return [1, 2].map((position) => ({
    driver_number: position,
    position,
    duration: duration[position - 1],
    number_of_laps: 20,
    points: position === 1 ? 25 : 18,
  }))
}

function openF1Server(rowsFor: (key: number) => OpenF1ResultRow[]) {
  return (url: string) => {
    const key = Number(new URL(url).searchParams.get('session_key'))

    if (url.includes('/session_result')) return json(rowsFor(key))
    if (url.includes('/drivers')) return json(DRIVERS)
    if (url.includes('/starting_grid')) {
      return json([
        { position: 1, driver_number: 1 },
        { position: 2, driver_number: 2 },
      ])
    }
    return json([])
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('refreshSession source priority', () => {
  it('writes a complete jolpica result as final', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T18:45:00Z')
    const ctx = makeContext(kv, [race], now)

    stubSources({ jolpica: (code) => json(makeSessionResults(code as SessionCode)) })

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('final')
    expect(result.source).toBe('jolpica')
    expect(result.complete).toBe(true)
    expect(result.fetchedAt).toBe(new Date(now).toISOString())
    expect(kv.puts).toBe(1)
  })

  it('falls back to OpenF1 provisionally for qualifying and the race', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-25T22:30:00Z')
    const ctx = makeContext(kv, [race], now)

    stubSources({
      jolpica: () => failing(404),
      openf1: openF1Server((key) =>
        key === 102 ? openF1Rows('Q') : openF1Rows('R'),
      ),
    })

    const qualifying = await refreshSession(targetFor(race, 'Q'), ctx)
    expect(qualifying.state).toBe('provisional')
    expect(qualifying.source).toBe('openf1')
    expect(qualifying.complete).toBe(true)
    expect(qualifying.session?.results[0].components?.Q3.time).toBe('1:15.300')

    const result = await refreshSession(targetFor(race, 'R'), ctx)
    expect(result.state).toBe('provisional')
    expect(result.source).toBe('openf1')
    expect(result.session?.results[0].components?.GRID.position).toBe(1)
  })

  it('keeps a pending result with a locked OpenF1 marker on 401', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T18:45:00Z')
    const ctx = makeContext(kv, [race], now)

    stubSources({
      jolpica: () => failing(404),
      openf1: (url) => (url.includes('/session_result') ? failing(401) : json([])),
    })

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('pending')
    expect(result.sources.openf1.state).toBe('locked')
    expect(result.sources.openf1.retryAt).toBeTruthy()
  })

  it('promotes a cached provisional result once jolpica publishes', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T18:45:00Z')
    const ctx = makeContext(kv, [race], now)

    const provisional = makeCached({ state: 'provisional', revision: 2 })
    kv.seed(keys.result('2026', '18', 'FP1'), provisional)
    stubSources({ jolpica: (code) => json(makeSessionResults(code as SessionCode)) })

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('final')
    expect(result.revision).toBe(3)
    expect(kv.puts).toBe(1)
  })

  it('does not call upstream while a final recheck is not due', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T19:00:00Z')
    const ctx = makeContext(kv, [race], now)

    kv.seed(
      keys.result('2026', '18', 'FP1'),
      makeCached({
        state: 'final',
        complete: true,
        recheckAt: new Date(now + 60 * 60_000).toISOString(),
      }),
    )
    const fetchSpy = stubSources({})

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('final')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('updates a final result in place when a recheck sees an amendment', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T19:00:00Z')
    const ctx = makeContext(kv, [race], now)

    const original = makeSessionResults('FP1')
    kv.seed(
      keys.result('2026', '18', 'FP1'),
      makeCached({
        state: 'final',
        complete: true,
        revision: 1,
        session: original,
        fetchedAt: new Date(now - 2 * 60 * 60_000).toISOString(),
        recheckAt: new Date(now - 1_000).toISOString(),
      }),
    )

    const amended = makeSessionResults('FP1', 2, {
      results: original.results.map((row, index) =>
        index === 0 ? { ...row, time: '1:99.999' } : row,
      ),
    })
    stubSources({ jolpica: () => json(amended) })

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('final')
    expect(result.revision).toBe(2)
    expect(result.session?.results[0].time).toBe('1:99.999')
    expect(result.fetchedAt).toBe(new Date(now).toISOString())
  })

  it('backs off after an OpenF1 429 instead of retrying every tick', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T18:45:00Z')
    const ctx = makeContext(kv, [race], now)

    stubSources({
      jolpica: () => failing(404),
      openf1: (url) =>
        url.includes('/session_result') ? failing(429, { 'Retry-After': '120' }) : json([]),
    })

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('pending')
    expect(result.sources.openf1.state).toBe('error')
    const retryAt = Date.parse(result.sources.openf1.retryAt ?? '')
    expect(retryAt - now).toBeGreaterThanOrEqual(ERROR_RETRY_MS - 1_000)
  })

  it('backs off after a jolpica 429 and carries the retry into nextAttemptAt', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T18:45:00Z')
    const ctx = makeContext(kv, [race], now)

    stubSources({
      jolpica: () => failing(429, { 'Retry-After': '600' }),
      openf1: () => json([]),
    })

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('pending')
    expect(result.sources.jolpica.state).toBe('error')
    expect(Date.parse(result.nextAttemptAt ?? '')).toBeGreaterThanOrEqual(now + 10 * 60_000)
  })

  it('reports a malformed alpha payload as an upstream error, not a crash', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T18:45:00Z')
    const ctx = makeContext(kv, [race], now, [])

    stubSources({ jolpica: () => json({ unexpected: true }) })

    const result = await refreshSession(targetFor(race, 'FP1'), ctx)

    expect(result.state).toBe('pending')
    expect(result.sources.jolpica.state).toBe('error')
    expect(result.sources.jolpica.error).toContain('Malformed')
  })
})

describe('dueSessions', () => {
  it('skips a final result until its recheck is due', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    const now = Date.parse('2026-10-23T19:00:00Z')
    const ctx = makeContext(kv, [race], now)

    kv.seed(
      keys.result('2026', '18', 'FP1'),
      makeCached({
        state: 'final',
        complete: true,
        recheckAt: new Date(now + 30 * 60_000).toISOString(),
      }),
    )

    expect(await dueSessions(ctx, now)).toEqual([])

    kv.seed(
      keys.result('2026', '18', 'FP1'),
      makeCached({
        state: 'final',
        complete: true,
        recheckAt: new Date(now - 1_000).toISOString(),
      }),
    )

    const due = await dueSessions(ctx, now)
    expect(due.map((target) => target.code)).toEqual(['FP1'])
  })

  it('ignores sessions that have not finished yet', async () => {
    const kv = new FakeKV()
    const race = makeRace()
    // FP1 has ended, FP2 starts at 21:00.
    const now = Date.parse('2026-10-23T19:00:00Z')
    const ctx = makeContext(kv, [race], now)

    const due = await dueSessions(ctx, now)
    expect(due.map((target) => target.code)).toEqual(['FP1'])
  })
})

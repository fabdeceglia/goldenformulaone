import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { keys } from '../src/cache'
import type { Env } from '../src/config'
import type { OpenF1SessionRow } from '../src/sources/openf1'
import { FakeKV, makeCached, makeRace, makeSessionResults } from './fixtures'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeEnv(kv: FakeKV): Env {
  return {
    RESULTS: kv as unknown as KVNamespace,
    JOLPICA_BASE: 'https://jolpica.test',
    OPENF1_BASE: 'https://openf1.test',
  }
}

/** Seed the metadata the scheduled handler reads before touching a session. */
function seedMetadata(kv: FakeKV, now: number, race = makeRace()): void {
  const sessions: OpenF1SessionRow[] = [
    { session_key: 101, session_name: 'Practice 1', date_start: '2026-10-23T17:30:00Z' },
  ]

  kv.seed(keys.calendar('2026'), { savedAt: now, data: [race] })
  kv.seed(keys.rounds('2026'), { savedAt: now, data: { '18': 'round_test' } })
  kv.seed(keys.drivers('2026'), { savedAt: now, data: 2 })
  kv.seed(keys.openf1Sessions('2026'), { savedAt: now, data: sessions })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('results endpoint', () => {
  it('serves a fresh cached result without touching upstream metadata', async () => {
    const kv = new FakeKV()
    const now = Date.now()
    kv.seed(
      keys.result('2026', '18', 'FP1'),
      makeCached({
        state: 'final',
        complete: true,
        checkedAt: new Date(now).toISOString(),
        recheckAt: new Date(now + 60 * 60_000).toISOString(),
      }),
    )

    const fetchSpy = vi.fn(() => Promise.resolve(json([])))
    vi.stubGlobal('fetch', fetchSpy)

    const response = await worker.fetch(
      new Request('https://worker.test/api/results/2026/18/FP1'),
      makeEnv(kv),
      { waitUntil: () => undefined } as unknown as ExecutionContext,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { state: string; source: string }
    expect(body.state).toBe('final')
    expect(body.source).toBe('jolpica')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('scheduled handler', () => {
  it('refreshes a finished session and records a heartbeat', async () => {
    const kv = new FakeKV()
    // Twenty minutes after FP1's estimated end, still inside the 24h poll window.
    const now = Date.parse('2026-10-23T18:50:00Z')
    seedMetadata(kv, now)

    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        Promise.resolve(
          String(input).includes('/f1/alpha/results/')
            ? json(makeSessionResults('FP1'))
            : json([]),
        ),
      ),
    )

    await worker.scheduled(
      { scheduledTime: now, cron: '*/2 * * * *', noRetry: () => undefined },
      makeEnv(kv),
      {} as ExecutionContext,
    )

    const stored = (await kv.get(keys.result('2026', '18', 'FP1'), { type: 'json' })) as {
      state: string
    }
    expect(stored.state).toBe('final')

    const status = (await kv.get(keys.status, { type: 'json' })) as {
      data: { lastRunAt: string; sessions: Array<{ code: string }> }
    }
    expect(status.data.lastRunAt).toBe(new Date(now).toISOString())
    expect(status.data.sessions.map((session) => session.code)).toContain('FP1')
  })

  it('leaves a final result alone until its recheck is due', async () => {
    const kv = new FakeKV()
    const now = Date.parse('2026-10-23T19:00:00Z')
    seedMetadata(kv, now)

    // A final result checked a moment ago, with a recheck an hour away.
    const checkedAt = new Date(now - 60_000).toISOString()
    kv.seed(keys.result('2026', '18', 'FP1'), {
      v: 2,
      revision: 3,
      season: '2026',
      round: '18',
      code: 'FP1',
      state: 'final',
      source: 'jolpica',
      complete: true,
      session: makeSessionResults('FP1'),
      fetchedAt: checkedAt,
      checkedAt,
      nextAttemptAt: null,
      recheckAt: new Date(now + 60 * 60_000).toISOString(),
      sources: {
        jolpica: { state: 'ready', count: 2, complete: true, checkedAt },
        openf1: { state: 'empty', count: 0, complete: false, checkedAt },
      },
    })

    const fetchSpy = vi.fn(() => Promise.resolve(json([])))
    vi.stubGlobal('fetch', fetchSpy)

    await worker.scheduled(
      { scheduledTime: now, cron: '*/2 * * * *', noRetry: () => undefined },
      makeEnv(kv),
      {} as ExecutionContext,
    )

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

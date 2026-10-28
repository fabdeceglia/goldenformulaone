import {
  emptySourceStatus,
  isSessionCode,
  toResultsResponse,
  type CachedResult,
  type ResultsResponse,
  type SourceStatus,
} from '../../src/shared/results'
import { readResult, readStatus, writeStatus } from './cache'
import {
  ON_DEMAND_DEADLINE_MS,
  ON_DEMAND_STALE_MS,
  type Env,
} from './config'
import { createRefreshContext, refreshDueSessions, refreshSession } from './results'
import { findRace, type SessionTarget } from './schedule'
import { sessionWindows } from '../../src/shared/schedule'

/**
 * Results cache Worker.
 *
 * Routes:
 *   GET /api/results/{season}/{round}/{code}
 *   GET /api/status
 *   GET /health
 *
 * The cron handler warms the same cache every two minutes. The browser only
 * ever sees a `ResultsResponse`; source bookkeeping stays server-side.
 */

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The Vercel rewrite keeps the browser same-origin, but a direct
      // `VITE_RESULTS_BASE` call is also supported as a fallback.
      'access-control-allow-origin': '*',
      ...headers,
    },
  })
}

function resultsResponse(cached: CachedResult): Response {
  const body: ResultsResponse = toResultsResponse(cached)
  return json(body, 200, {
    'cache-control': body.state === 'final' ? 'public, max-age=30' : 'no-store',
  })
}

function iso(now: number): string {
  return new Date(now).toISOString()
}

function pending(
  season: string,
  round: string,
  code: string,
  now: number,
  sources?: CachedResult['sources'],
): CachedResult {
  const checkedAt = iso(now)
  return {
    v: 2,
    revision: 0,
    season,
    round,
    code: code as CachedResult['code'],
    state: 'pending',
    source: null,
    complete: false,
    session: null,
    fetchedAt: null,
    checkedAt,
    nextAttemptAt: null,
    recheckAt: null,
    sources: sources ?? {
      jolpica: emptySourceStatus(checkedAt),
      openf1: emptySourceStatus(checkedAt),
    },
  }
}

function parseResultsPath(pathname: string): { season: string; round: string; code: string } | null {
  const match = /^\/api\/results\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null

  try {
    return {
      season: decodeURIComponent(match[1]),
      round: decodeURIComponent(match[2]),
      code: decodeURIComponent(match[3]),
    }
  } catch {
    return null
  }
}

function validParams(params: { season: string; round: string; code: string }): boolean {
  const season = Number(params.season)
  const round = Number(params.round)
  return (
    /^\d{4}$/.test(params.season) &&
    season >= 1950 &&
    season <= 2100 &&
    /^\d{1,3}$/.test(params.round) &&
    round >= 1 &&
    isSessionCode(params.code)
  )
}

function buildTarget(
  races: SessionTarget['race'][],
  season: string,
  round: string,
  code: string,
): SessionTarget | null {
  const race = findRace(races, round)
  if (!race || !isSessionCode(code)) return null

  const window = sessionWindows(race).find((candidate) => candidate.entry.code === code)
  if (!window) return null

  return { season, round, code, race, window }
}

function isFresh(cached: CachedResult, now: number): boolean {
  if (cached.state === 'final') {
    if (cached.recheckAt !== null) return now < Date.parse(cached.recheckAt)
    // After the last amendment check the schedule is intentionally empty; a
    // day-old final can be revalidated once in the background.
    return now - Date.parse(cached.checkedAt) < ON_DEMAND_STALE_MS
  }
  return now - Date.parse(cached.checkedAt) < ON_DEMAND_STALE_MS
}

async function handleResults(
  _request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: { season: string; round: string; code: string },
): Promise<Response> {
  if (!validParams(params)) {
    return json({ error: 'Invalid season, round or session code' }, 400)
  }

  const now = Date.now()
  const deadline = now + ON_DEMAND_DEADLINE_MS
  const cached = await readResult(env, params.season, params.round, params.code)

  // A fresh result must not depend on the metadata APIs: a jolpica hiccup must
  // never hide a table the Worker already has.
  if (cached && isFresh(cached, now)) return resultsResponse(cached)

  let context
  try {
    context = await createRefreshContext(env, now, deadline, params.season)
  } catch (cause) {
    const fallback = cached ?? pending(params.season, params.round, params.code, now)
    console.error(
      JSON.stringify({
        event: 'results.metadata.error',
        season: params.season,
        round: params.round,
        code: params.code,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    )
    return resultsResponse(fallback)
  }

  const target = buildTarget(context.races, params.season, params.round, params.code)
  if (!target) {
    return json({ error: 'Unknown round or session' }, 404)
  }

  if (cached) {
    // A stale table is still useful: return it immediately and revalidate in
    // the background. The revision guard prevents a downgrade if this races
    // with cron.
    ctx.waitUntil(
      refreshSession(target, context).catch((cause: unknown) => {
        console.error(
          JSON.stringify({
            event: 'results.background.error',
            season: params.season,
            round: params.round,
            code: params.code,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        )
      }),
    )
    return resultsResponse(cached)
  }

  if (now < target.window.end) {
    return resultsResponse(pending(params.season, params.round, params.code, now))
  }

  try {
    const refreshed = await refreshSession(target, context)
    console.log(
      JSON.stringify({
        event: 'results.refresh',
        season: params.season,
        round: params.round,
        code: params.code,
        state: refreshed.state,
        source: refreshed.source,
        count: refreshed.session?.results.length ?? 0,
      }),
    )
    return resultsResponse(refreshed)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const checkedAt = iso(now)
    const errorStatus: SourceStatus = {
      state: 'error',
      count: 0,
      complete: false,
      checkedAt,
      error: message,
    }
    const fallback = pending(params.season, params.round, params.code, now, {
      jolpica: errorStatus,
      openf1: emptySourceStatus(checkedAt),
    })
    console.error(
      JSON.stringify({
        event: 'results.refresh.error',
        season: params.season,
        round: params.round,
        code: params.code,
        error: message,
      }),
    )
    return resultsResponse(fallback)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed' }, 405)
      }
      return json({ ok: true, now: iso(Date.now()) })
    }

    if (url.pathname === '/api/status') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed' }, 405)
      }
      const status = await readStatus(env)
      return json({ ...status, now: iso(Date.now()) }, 200, { 'cache-control': 'no-store' })
    }

    const params = parseResultsPath(url.pathname)
    if (params) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed' }, 405)
      }
      return handleResults(request, env, ctx, params)
    }

    return json({ error: 'Not found' }, 404)
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const now = Number.isFinite(controller.scheduledTime) ? controller.scheduledTime : Date.now()

    try {
      const context = await createRefreshContext(env, now)
      const batch = await refreshDueSessions(context, now)
      const previous = await readStatus(env)

      const sessions = new Map(previous.sessions.map((session) => [
        `${session.season}:${session.round}:${session.code}`,
        session,
      ]))
      for (const result of batch.results) {
        sessions.set(`${result.season}:${result.round}:${result.code}`, {
          season: result.season,
          round: result.round,
          code: result.code,
          state: result.state,
          source: result.source,
          checkedAt: result.checkedAt,
        })
      }

      await writeStatus(
        env,
        {
          lastRunAt: iso(now),
          lastError: batch.errors[0] ?? null,
          sessions: [...sessions.values()].slice(-100),
        },
        now,
      )

      if (batch.errors.length > 0) {
        console.error(JSON.stringify({ event: 'cron.session.errors', errors: batch.errors }))
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.error(JSON.stringify({ event: 'cron.error', error: message }))
      await writeStatus(
        env,
        { lastRunAt: iso(now), lastError: message, sessions: [] },
        now,
        true,
      ).catch(() => undefined)
    }
  },
}

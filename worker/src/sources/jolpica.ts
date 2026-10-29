import type { AlphaRound, AlphaSessionResults, Race, SessionCode } from '../../../src/api/types'
import { unwrapAlpha } from '../../../src/shared/alpha'
import {
  alphaCompleteness,
  assessCompleteness,
  type SourceCheck,
} from '../../../src/shared/results'
import {
  DEFAULT_JOLPICA_BASE,
  DEFAULT_USER_AGENT,
  FALLBACK_EXPECTED_DRIVERS,
  type Env,
} from '../config'
import { UpstreamError, type FetchOptions } from '../http'
import { fetchViaRelay } from '../relay'

/**
 * jolpica adapter: the calendar, the alpha round map and session results.
 *
 * Rate limit (unauthenticated): 4 requests/second burst and 500 requests/hour.
 * The cron cap and provisional backoff keep the Worker comfortably inside it.
 */

export interface SourceOptions extends FetchOptions {
  now: number
}

function base(env: Env): string {
  return (env.JOLPICA_BASE ?? DEFAULT_JOLPICA_BASE).replace(/\/+$/, '')
}

function headers(env: Env): HeadersInit {
  return {
    Accept: 'application/json',
    'User-Agent': env.JOLPICA_USER_AGENT ?? DEFAULT_USER_AGENT,
  }
}

function emptyCheck(now: number, error?: string): SourceCheck {
  return {
    source: 'jolpica',
    state: 'empty',
    count: 0,
    complete: false,
    checkedAt: new Date(now).toISOString(),
    ...(error ? { error } : {}),
  }
}

function errorCheck(cause: unknown, now: number): SourceCheck {
  const error = cause instanceof UpstreamError ? cause : null
  const message = cause instanceof Error ? cause.message : 'Unknown jolpica error'

  return {
    source: 'jolpica',
    state: 'error',
    count: 0,
    complete: false,
    checkedAt: new Date(now).toISOString(),
    error: message,
    ...(error?.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
  }
}

interface RacesPayload {
  MRData?: {
    total?: string
    RaceTable?: { Races?: Race[] }
  }
}

export async function fetchCalendar(
  season: string,
  env: Env,
  options: SourceOptions,
): Promise<Race[]> {
  const payload = await fetchViaRelay<RacesPayload>(
    `${base(env)}/ergast/f1/${encodeURIComponent(season)}/races/?limit=100`,
    env.JOLPICA_RELAY,
    { headers: headers(env) },
    options,
  )
  return payload.MRData?.RaceTable?.Races ?? []
}

export async function fetchRoundIds(
  season: string,
  env: Env,
  options: SourceOptions,
): Promise<Record<string, string>> {
  const payload = await fetchViaRelay<
    AlphaRound[] | { metadata: unknown; data: AlphaRound[] }
  >(
    `${base(env)}/f1/alpha/core/rounds/?year=${encodeURIComponent(season)}`,
    env.JOLPICA_RELAY,
    { headers: headers(env) },
    options,
  )
  const rounds = unwrapAlpha<AlphaRound[]>(payload)
  const mapped: Record<string, string> = {}

  for (const round of Array.isArray(rounds) ? rounds : []) {
    if (typeof round.number === 'number' && typeof round.id === 'string') {
      mapped[String(round.number)] = round.id
    }
  }

  return mapped
}

interface DriverStandingsPayload {
  MRData?: { total?: string }
}

export async function fetchExpectedDrivers(
  season: string,
  env: Env,
  options: SourceOptions,
): Promise<number> {
  try {
    const payload = await fetchViaRelay<DriverStandingsPayload>(
      `${base(env)}/ergast/f1/${encodeURIComponent(season)}/driverstandings/?limit=100`,
      env.JOLPICA_RELAY,
      { headers: headers(env) },
      options,
    )
    const total = Number(payload.MRData?.total)
    return Number.isFinite(total) && total > 0 ? total : FALLBACK_EXPECTED_DRIVERS
  } catch {
    // A missing standings response must not block the result itself.
    return FALLBACK_EXPECTED_DRIVERS
  }
}

export interface JolpicaSessionResult {
  check: SourceCheck
  session: AlphaSessionResults | null
}

export async function fetchSessionResult(
  roundId: string | null,
  code: SessionCode,
  expectedDrivers: number,
  env: Env,
  options: SourceOptions,
): Promise<JolpicaSessionResult> {
  if (!roundId) {
    return { check: errorCheck(new Error('No alpha round id for this round'), options.now), session: null }
  }

  try {
    const payload = await fetchViaRelay<
      AlphaSessionResults | { metadata: unknown; data: AlphaSessionResults }
    >(
      `${base(env)}/f1/alpha/results/${encodeURIComponent(roundId)}/${code}/`,
      env.JOLPICA_RELAY,
      { headers: headers(env) },
      options,
    )
    const session = unwrapAlpha<AlphaSessionResults>(payload)

    if (!session || !Array.isArray(session.results)) {
      return { check: errorCheck(new Error('Malformed alpha session payload'), options.now), session: null }
    }

    if (session.results.length === 0) {
      return { check: emptyCheck(options.now), session }
    }

    const counts = alphaCompleteness(session)
    const completeness = assessCompleteness(counts, expectedDrivers, code)

    return {
      check: {
        source: 'jolpica',
        state: 'ready',
        count: completeness.count,
        complete: completeness.complete,
        checkedAt: new Date(options.now).toISOString(),
      },
      session,
    }
  } catch (cause) {
    if (cause instanceof UpstreamError && cause.status === 404) {
      return { check: emptyCheck(options.now), session: null }
    }
    return { check: errorCheck(cause, options.now), session: null }
  }
}


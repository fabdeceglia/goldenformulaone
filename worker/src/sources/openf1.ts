import type { AlphaSessionResults, Race, SessionCode } from '../../../src/api/types'
import {
  assessCompleteness,
  type SourceCheck,
} from '../../../src/shared/results'
import {
  mapOpenF1Results,
  rawCompleteness,
  type OpenF1DriverRow,
  type OpenF1ResultRow,
} from '../../../src/shared/openf1Map'
import { sessionWindows } from '../../../src/shared/schedule'
import {
  DEFAULT_OPENF1_BASE,
  OPENF1_REQUEST_GAP_MS,
  type Env,
} from '../config'
import { fetchJson, sleep, UpstreamError, type FetchOptions } from '../http'

/**
 * OpenF1 fallback adapter.
 *
 * Historical classifications are free; the real-time feed needs a paid key.
 * The free tier answers 401/403 for every endpoint during a live session, and
 * is limited to 3 requests/second and 30/minute, so every call goes through one
 * serial queue with a 500 ms gap.
 */

export interface SourceOptions extends FetchOptions {
  now: number
}

export interface OpenF1SessionRow {
  session_key: number
  session_name: string
  session_type?: string
  date_start: string
  date_end?: string
  meeting_key?: number
  circuit_key?: number
  circuit_short_name?: string
  location?: string
  country_name?: string
  year?: number
  is_cancelled?: boolean
}

export interface OpenF1StartingGridRow {
  position: number
  driver_number: number
  session_key?: number
}

export interface OpenF1Outcome {
  check: SourceCheck
  session: AlphaSessionResults | null
}

const SESSION_NAMES: Record<SessionCode, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint Qualifying',
  SR: 'Sprint',
  Q: 'Qualifying',
  R: 'Race',
}

let nextRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

function base(env: Env): string {
  return (env.OPENF1_BASE ?? DEFAULT_OPENF1_BASE).replace(/\/+$/, '')
}

function headers(env: Env): HeadersInit {
  const value: Record<string, string> = { Accept: 'application/json' }
  if (env.OPENF1_API_KEY) value.Authorization = `Bearer ${env.OPENF1_API_KEY}`
  return value
}

function request<T>(path: string, env: Env, options: SourceOptions): Promise<T> {
  const run = async () => {
    if (options.signal?.aborted) throw new Error('Request aborted')

    const now = Date.now()
    const wait = nextRequestAt - now
    nextRequestAt = Math.max(now, nextRequestAt) + OPENF1_REQUEST_GAP_MS
    if (wait > 0) await sleep(wait)
    if (options.signal?.aborted) throw new Error('Request aborted')

    return fetchJson<T>(`${base(env)}${path}`, { headers: headers(env) }, options)
  }

  // `queue` never settles into a rejected state, otherwise one failure would
  // stop every later request in the isolate.
  const result = queue.then(run, run)
  queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function emptyCheck(now: number): SourceCheck {
  return {
    source: 'openf1',
    state: 'empty',
    count: 0,
    complete: false,
    checkedAt: new Date(now).toISOString(),
  }
}

function errorCheck(cause: unknown, now: number): SourceCheck {
  const error = cause instanceof UpstreamError ? cause : null
  const status = error?.status
  const state = status === 401 || status === 403 ? 'locked' : status === 404 ? 'empty' : 'error'
  const message = cause instanceof Error ? cause.message : 'Unknown OpenF1 error'

  return {
    source: 'openf1',
    state,
    count: 0,
    complete: false,
    checkedAt: new Date(now).toISOString(),
    ...(state === 'error' ? { error: message } : {}),
    ...(error?.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
  }
}

export async function fetchSessions(
  season: string,
  env: Env,
  options: SourceOptions,
): Promise<OpenF1SessionRow[]> {
  const rows = await request<OpenF1SessionRow[]>(
    `/sessions?year=${encodeURIComponent(season)}`,
    env,
    options,
  )
  return Array.isArray(rows) ? rows : []
}

/** The jolpica calendar date for a session code, when the schedule has one. */
function scheduledDate(race: Race, code: SessionCode): string | undefined {
  switch (code) {
    case 'FP1':
      return race.FirstPractice?.date
    case 'FP2':
      return race.SecondPractice?.date
    case 'FP3':
      return race.ThirdPractice?.date
    case 'SQ':
      return race.SprintQualifying?.date
    case 'SR':
      return race.Sprint?.date ?? race.date
    case 'Q':
      return race.Qualifying?.date
    case 'R':
      return race.date
    default:
      return undefined
  }
}

/**
 * Match a jolpica session to an OpenF1 session by name and scheduled date,
 * with a nearest-day fallback for a late-night session that lands on a
 * different UTC day in one calendar. This mirrors the browser join.
 */
export function resolveSession(
  race: Race,
  code: SessionCode,
  sessions: readonly OpenF1SessionRow[],
): OpenF1SessionRow | null {
  const name = SESSION_NAMES[code]
  const names = code === 'SQ' ? [name, 'Sprint Shootout'] : [name]
  const wantedDate = scheduledDate(race, code)
  if (!wantedDate) return null

  const candidates = sessions.filter(
    (session) => names.includes(session.session_name) && !session.is_cancelled,
  )

  const exact = candidates.find((session) => session.date_start.slice(0, 10) === wantedDate)
  if (exact) return exact

  const wanted = Date.parse(`${wantedDate}T12:00:00Z`)
  let nearest: OpenF1SessionRow | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const session of candidates) {
    const distance = Math.abs(Date.parse(session.date_start) - wanted)
    if (distance < nearestDistance) {
      nearest = session
      nearestDistance = distance
    }
  }

  // Three days is generous enough for a timezone shift and strict enough that
  // a missing round cannot silently open a different race.
  return nearest && nearestDistance <= 3 * 86_400_000 ? nearest : null
}

async function startingGrid(
  race: Race,
  code: SessionCode,
  sessions: readonly OpenF1SessionRow[],
  env: Env,
  options: SourceOptions,
): Promise<Map<number, number>> {
  const gridCode: SessionCode | null = code === 'R' ? 'Q' : code === 'SR' ? 'SQ' : null
  if (!gridCode) return new Map()

  const resolved = resolveSession(race, gridCode, sessions)
  if (!resolved) return new Map()

  try {
    const rows = await request<OpenF1StartingGridRow[]>(
      `/starting_grid?session_key=${resolved.session_key}`,
      env,
      options,
    )
    if (Array.isArray(rows) && rows.length > 0) {
      return new Map(rows.map((row) => [row.driver_number, row.position]))
    }
  } catch (cause) {
    if (options.signal?.aborted) throw cause
  }

  // The grid feed is normally available for qualifying. If it is not, fall
  // back to the qualifying classification order: the same order minus any grid
  // penalties, and it may omit drivers without a qualifying time.
  try {
    const rows = await request<OpenF1ResultRow[]>(
      `/session_result?session_key=${resolved.session_key}`,
      env,
      options,
    )
    return new Map(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => typeof row.position === 'number' && row.position > 0)
        .map((row) => [row.driver_number, row.position as number]),
    )
  } catch (cause) {
    if (options.signal?.aborted) throw cause
    return new Map()
  }
}

export async function fetchSessionResult(
  race: Race,
  code: SessionCode,
  sessions: readonly OpenF1SessionRow[],
  expectedDrivers: number,
  env: Env,
  options: SourceOptions,
): Promise<OpenF1Outcome> {
  const resolved = resolveSession(race, code, sessions)
  if (!resolved) return { check: emptyCheck(options.now), session: null }

  try {
    const rows = await request<OpenF1ResultRow[]>(
      `/session_result?session_key=${resolved.session_key}`,
      env,
      options,
    )

    if (!Array.isArray(rows) || rows.length === 0) {
      return { check: emptyCheck(options.now), session: null }
    }

    let drivers: OpenF1DriverRow[] = []
    try {
      drivers = await request<OpenF1DriverRow[]>(
        `/drivers?session_key=${resolved.session_key}`,
        env,
        options,
      )
    } catch (cause) {
      if (options.signal?.aborted) throw cause
      // A missing driver list costs names, not the classification. Do not turn
      // a valid result into an error because the enrichment feed failed.
    }

    const gridByDriver = await startingGrid(race, code, sessions, env, options)
    const counts = rawCompleteness(rows)
    const completeness = assessCompleteness(counts, expectedDrivers, code)
    const window = sessionWindows(race).find((candidate) => candidate.entry.code === code)
    const timestamp = window
      ? `${window.entry.date}T${window.entry.time ?? '00:00:00Z'}`
      : `${race.date}T${race.time ?? '00:00:00Z'}`

    const session = mapOpenF1Results(rows, {
      code,
      timestamp,
      round: {
        id: String(race.round),
        number: Number(race.round),
        name: race.raceName,
      },
      circuit: {
        id: race.Circuit.circuitId,
        name: race.Circuit.circuitName,
        locality: race.Circuit.Location.locality,
        country_code: race.Circuit.Location.country,
      },
      drivers,
      gridByDriver,
    })

    return {
      check: {
        source: 'openf1',
        state: 'ready',
        count: completeness.count,
        complete: completeness.complete,
        checkedAt: new Date(options.now).toISOString(),
      },
      session,
    }
  } catch (cause) {
    return { check: errorCheck(cause, options.now), session: null }
  }
}

import type { Race, SessionCode } from './types'

/**
 * OpenF1, the free source of car telemetry and circuit geometry.
 *
 * Historical sessions are free (a session is downloadable from about thirty
 * minutes after the chequered flag), and the API sends
 * `Access-Control-Allow-Origin: *`, so the browser can call it directly.
 *
 * The free tier is rate limited to 3 requests a second and 30 a minute. Every
 * request goes through one serial queue with a gap a little over two seconds,
 * which keeps a full-field replay comfortably inside the minute budget. The
 * shipped loader prefers pre-baked assets and only comes here when one is
 * missing, so this slow path is the fallback rather than the normal one.
 */
const OPENF1_BASE =
  (import.meta.env.VITE_OPENF1_BASE as string | undefined) ?? 'https://api.openf1.org/v1'

const MULTIVIEWER_BASE =
  (import.meta.env.VITE_MULTIVIEWER_BASE as string | undefined) ??
  'https://api.multiviewer.app/api/v1'

/** A little over two seconds keeps a burst of 22 locations under 30 a minute. */
const REQUEST_GAP_MS = 2_100

let nextRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

export interface OpenF1Session {
  session_key: number
  session_name: string
  session_type: string
  date_start: string
  date_end: string
  meeting_key: number
  circuit_key: number
  circuit_short_name: string
  location?: string
  country_name?: string
  year: number
  is_cancelled?: boolean
}

export interface OpenF1Driver {
  driver_number: number
  broadcast_name?: string
  full_name: string
  name_acronym: string
  team_name: string
  team_colour?: string
  first_name?: string
  last_name?: string
}

export interface OpenF1Position {
  date: string
  session_key: number
  driver_number: number
  position: number
}

export interface OpenF1Location {
  date: string
  session_key: number
  driver_number: number
  x: number
  y: number
  z?: number
}

/** The circuit geometry as the Multiviewer API returns it. */
export interface MultiviewerCircuit {
  circuitKey: number
  circuitName?: string
  rotation: number
  x: number[]
  y: number[]
}

export interface ResolvedReplaySession {
  sessionKey: number
  circuitKey: number
  session: OpenF1Session
}

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis))

const REQUEST_TIMEOUT_MS = 30_000

async function fetchJson<T>(url: string, signal?: AbortSignal, attempt = 0): Promise<T> {
  // A single stalled connection would otherwise block the whole sequential
  // field fetch, so each request gets its own deadline on top of the caller's
  // abort signal.
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })

    // A burst can still trip the limiter. Back off and try again rather than
    // failing a replay halfway through a field.
    if (response.status === 429 && attempt < 3) {
      await sleep(5_000 * (attempt + 1))
      return fetchJson<T>(url, signal, attempt + 1)
    }

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`)
    }

    return (await response.json()) as T
  } catch (cause) {
    if (signal?.aborted) throw cause
    if (controller.signal.aborted) throw new Error('Request timed out')
    throw cause
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Serialises and throttles one request, so callers can simply await it. */
function request<T>(path: string, signal?: AbortSignal, base = OPENF1_BASE): Promise<T> {
  const run = async () => {
    const now = Date.now()
    const wait = nextRequestAt - now
    nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_GAP_MS
    if (wait > 0) await sleep(wait)
    return fetchJson<T>(`${base}${path}`, signal)
  }

  // `queue` never settles into a rejected state, otherwise one failure would
  // stop every later request in the session.
  const result = queue.then(run, run)
  queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const sessionCache = new Map<string, Promise<OpenF1Session[]>>()

/** Every session of a season, fetched once per page load. */
export function sessions(year: string | number): Promise<OpenF1Session[]> {
  const key = String(year)
  const cached = sessionCache.get(key)
  if (cached) return cached

  const promise = request<OpenF1Session[]>(`/sessions?year=${key}`).catch((cause: unknown) => {
    sessionCache.delete(key)
    throw cause
  })
  sessionCache.set(key, promise)
  return promise
}

/**
 * The OpenF1 session behind a jolpica round and session code.
 *
 * There is no shared id between the two APIs, so the join is name + date:
 * OpenF1 calls the race `Race` and the sprint `Sprint`, and the scheduled day
 * comes from jolpica. A nearest-day fallback covers a late-night race that
 * lands on a different UTC day in one of the two calendars.
 */
export async function resolveSessionKey(
  race: Race,
  code: SessionCode,
): Promise<ResolvedReplaySession | null> {
  if (code !== 'R' && code !== 'SR') return null

  const name = code === 'R' ? 'Race' : 'Sprint'
  const wantedDate = code === 'R' ? race.date : (race.Sprint?.date ?? race.date)
  const candidates = (await sessions(race.season)).filter(
    (session) => session.session_name === name && !session.is_cancelled,
  )

  const exact = candidates.find((session) => session.date_start.slice(0, 10) === wantedDate)
  if (exact) {
    return { sessionKey: exact.session_key, circuitKey: exact.circuit_key, session: exact }
  }

  const wanted = Date.parse(`${wantedDate}T12:00:00Z`)
  let nearest: OpenF1Session | null = null
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
  if (!nearest || nearestDistance > 3 * 86_400_000) return null

  return { sessionKey: nearest.session_key, circuitKey: nearest.circuit_key, session: nearest }
}

export const openf1 = {
  sessions,

  drivers: (sessionKey: number, signal?: AbortSignal) =>
    request<OpenF1Driver[]>(`/drivers?session_key=${sessionKey}`, signal),

  positions: (sessionKey: number, signal?: AbortSignal) =>
    request<OpenF1Position[]>(`/position?session_key=${sessionKey}`, signal),

  /**
   * One driver's location feed. The endpoint refuses an unfiltered query
   * ("too much data at once"), so a full field is one request per car.
   */
  location: (sessionKey: number, driverNumber: number, signal?: AbortSignal) =>
    request<OpenF1Location[]>(
      `/location?session_key=${sessionKey}&driver_number=${driverNumber}`,
      signal,
    ),

  /** Circuit outline in the same x/y frame as the location feed. */
  circuit: (circuitKey: number, year: number | string): Promise<MultiviewerCircuit> =>
    request<MultiviewerCircuit>(
      `/circuits/${circuitKey}/${year}`,
      undefined,
      MULTIVIEWER_BASE,
    ),
}

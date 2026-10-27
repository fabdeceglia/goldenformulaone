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

/**
 * A lookup that only needs a handful of requests can run tighter: the free
 * tier also allows three requests a second, so 500 ms is still conservative.
 * The replay path keeps the slower gap above for its full-field burst.
 */
export const SHORT_REQUEST_GAP_MS = 500

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

export interface OpenF1Lap {
  session_key: number
  driver_number: number
  lap_number: number
  date_start: string
  lap_duration?: number | null
  duration_sector_1?: number | null
  duration_sector_2?: number | null
  duration_sector_3?: number | null
  i1_speed?: number | null
  i2_speed?: number | null
  st_speed?: number | null
  is_pit_out_lap?: boolean | null
}

/** One row of OpenF1's per-car telemetry (`/car_data`), about 3.7 Hz. */
export interface OpenF1CarData {
  date: string
  driver_number: number
  session_key?: number
  meeting_key?: number
  speed?: number | null
  rpm?: number | null
  /** OpenF1 calls the gear `n_gear`; 0 means neutral. */
  n_gear?: number | null
  throttle?: number | null
  /** 100 when the pedal is pressed, 0 when it is not. */
  brake?: number | null
  /** 8 = eligible; 10/12/14 = open. */
  drs?: number | null
}

export interface OpenF1Stint {
  session_key: number
  driver_number: number
  stint_number: number
  lap_start: number
  lap_end: number
  compound: string
  tyre_age_at_start?: number
}

export interface OpenF1Interval {
  date: string
  session_key: number
  driver_number: number
  gap_to_leader?: number | string | null
  interval?: number | string | null
}

export interface OpenF1Weather {
  date: string
  session_key: number
  meeting_key?: number
  air_temperature?: number | null
  track_temperature?: number | null
  humidity?: number | null
  pressure?: number | null
  rainfall?: number | null
  wind_speed?: number | null
  wind_direction?: number | null
}

/** One row of OpenF1's race-control feed (`/race_control`). */
export interface OpenF1RaceControl {
  date: string
  session_key: number
  meeting_key?: number
  driver_number?: number | null
  lap_number?: number | null
  category?: string | null
  flag?: string | null
  scope?: string | null
  sector?: number | null
  qualifying_phase?: number | null
  message?: string | null
}

/** One row of OpenF1's final classification (`/session_result`). */
export interface OpenF1SessionResult {
  session_key: number
  driver_number: number
  position?: number | null
  /** Seconds for practice and the race, an array of segment laps for qualifying. */
  duration?: number | (number | null)[] | null
  gap_to_leader?: number | string | (number | null)[] | null
  number_of_laps?: number | null
  points?: number | null
  dnf?: boolean
  dns?: boolean
  dsq?: boolean
}

/** One row of OpenF1's starting-grid feed for a qualifying session. */
export interface OpenF1StartingGrid {
  position: number
  driver_number: number
  lap_duration?: number | null
  meeting_key: number
  session_key: number
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
function request<T>(
  path: string,
  signal?: AbortSignal,
  base = OPENF1_BASE,
  gap = REQUEST_GAP_MS,
): Promise<T> {
  const run = async () => {
    const now = Date.now()
    const wait = nextRequestAt - now
    nextRequestAt = Math.max(now, nextRequestAt) + gap
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
export function sessions(
  year: string | number,
  gap = REQUEST_GAP_MS,
): Promise<OpenF1Session[]> {
  const key = String(year)
  const cached = sessionCache.get(key)
  if (cached) return cached

  const promise = request<OpenF1Session[]>(
    `/sessions?year=${key}`,
    undefined,
    OPENF1_BASE,
    gap,
  ).catch((cause: unknown) => {
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
 * OpenF1 names the sessions "Practice 1", "Qualifying", "Race" and so on, and
 * the scheduled day comes from jolpica. A nearest-day fallback covers a
 * late-night session that lands on a different UTC day in one calendar.
 */
const OPENF1_SESSION_NAMES: Partial<Record<SessionCode, string>> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint Qualifying',
  SR: 'Sprint',
  Q: 'Qualifying',
  R: 'Race',
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

export async function resolveSessionKey(
  race: Race,
  code: SessionCode,
  gap = REQUEST_GAP_MS,
): Promise<ResolvedReplaySession | null> {
  const name = OPENF1_SESSION_NAMES[code]
  if (!name) return null

  // OpenF1 has used both names for the sprint qualifying session.
  const names = code === 'SQ' ? [name, 'Sprint Shootout'] : [name]
  const wantedDate = scheduledDate(race, code)
  if (!wantedDate) return null

  const candidates = (await sessions(race.season, gap)).filter(
    (session) => names.includes(session.session_name) && !session.is_cancelled,
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

/**
 * A query fragment that bounds an endpoint to `[from, to)`.
 *
 * The operators have to stay literal. `URLSearchParams` turns `>=` into `%3D`,
 * and OpenF1 answers a date-filtered `car_data` request with a 500 when it
 * receives the encoded form. UTC without a timezone suffix is the format the
 * filters expect (`2023-09-02T14:58:52.514`).
 */
function dateWindow(from: number, to: number): string {
  const stamp = (value: number) => new Date(value).toISOString().slice(0, 23)
  return `&date>=${stamp(from)}&date<${stamp(to)}`
}

export const openf1 = {
  sessions,

  drivers: (sessionKey: number, signal?: AbortSignal, gap = REQUEST_GAP_MS) =>
    request<OpenF1Driver[]>(`/drivers?session_key=${sessionKey}`, signal, OPENF1_BASE, gap),

  /** Final classification, available from about 30 minutes after the flag. */
  sessionResult: (sessionKey: number, signal?: AbortSignal, gap = REQUEST_GAP_MS) =>
    request<OpenF1SessionResult[]>(
      `/session_result?session_key=${sessionKey}`,
      signal,
      OPENF1_BASE,
      gap,
    ),

  /**
   * The starting grid for a qualifying session. OpenF1 only publishes this for
   * qualifying/sprint qualifying, not for the race itself; the app uses it to
   * fill the race table's grid column when jolpica is missing.
   */
  startingGrid: (sessionKey: number, signal?: AbortSignal, gap = REQUEST_GAP_MS) =>
    request<OpenF1StartingGrid[]>(
      `/starting_grid?session_key=${sessionKey}`,
      signal,
      OPENF1_BASE,
      gap,
    ),

  positions: (sessionKey: number, signal?: AbortSignal) =>
    request<OpenF1Position[]>(`/position?session_key=${sessionKey}`, signal),

  /** Lap start/end times, used for the lap counter and the replay window. */
  laps: (sessionKey: number, signal?: AbortSignal, gap = REQUEST_GAP_MS) =>
    request<OpenF1Lap[]>(`/laps?session_key=${sessionKey}`, signal, OPENF1_BASE, gap),

  /**
   * One driver's telemetry for a lap-sized window. Filtering by date is
   * mandatory: a whole qualifying session is about 2.9 MB for one driver.
   */
  carData: (
    sessionKey: number,
    driverNumber: number,
    from: number,
    to: number,
    signal?: AbortSignal,
  ) =>
    request<OpenF1CarData[]>(
      `/car_data?session_key=${sessionKey}&driver_number=${driverNumber}${dateWindow(from, to)}`,
      signal,
      OPENF1_BASE,
      SHORT_REQUEST_GAP_MS,
    ),

  /** Tyre stints, used by the timing tower. */
  stints: (sessionKey: number, signal?: AbortSignal) =>
    request<OpenF1Stint[]>(`/stints?session_key=${sessionKey}`, signal),

  /** Gaps to the car ahead, used by the timing tower. */
  intervals: (sessionKey: number, signal?: AbortSignal) =>
    request<OpenF1Interval[]>(`/intervals?session_key=${sessionKey}`, signal),

  /** Track conditions, sampled about once a minute. */
  weather: (sessionKey: number, signal?: AbortSignal) =>
    request<OpenF1Weather[]>(`/weather?session_key=${sessionKey}`, signal),

  /** Race-control messages, used for safety-car, VSC, red and yellow flag periods. */
  raceControl: (sessionKey: number, signal?: AbortSignal) =>
    request<OpenF1RaceControl[]>(`/race_control?session_key=${sessionKey}`, signal),

  /**
   * One driver's location feed. The endpoint refuses an unfiltered query
   * ("too much data at once"), so a full field is one request per car.
   * Passing `from`/`to` crops the response to a lap-sized window and tightens
   * the request gap, which is what the qualifying battle uses.
   */
  location: (
    sessionKey: number,
    driverNumber: number,
    signal?: AbortSignal,
    from?: number,
    to?: number,
  ) =>
    request<OpenF1Location[]>(
      `/location?session_key=${sessionKey}&driver_number=${driverNumber}${
        from !== undefined && to !== undefined ? dateWindow(from, to) : ''
      }`,
      signal,
      OPENF1_BASE,
      from !== undefined && to !== undefined ? SHORT_REQUEST_GAP_MS : REQUEST_GAP_MS,
    ),

  /**
   * Circuit outline in the same x/y frame as the location feed. The battle
   * passes the short gap: Multiviewer has no OpenF1-style rate limit, and the
   * queue would otherwise add two seconds to the setup screen.
   */
  circuit: (
    circuitKey: number,
    year: number | string,
    gap = REQUEST_GAP_MS,
  ): Promise<MultiviewerCircuit> =>
    request<MultiviewerCircuit>(
      `/circuits/${circuitKey}/${year}`,
      undefined,
      MULTIVIEWER_BASE,
      gap,
    ),
}

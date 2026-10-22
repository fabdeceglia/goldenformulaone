import { openf1, resolveSessionKey } from '../api/openf1'
import type {
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Session,
  OpenF1Stint,
  OpenF1Weather,
} from '../api/openf1'
import type { Race, SessionCode } from '../api/types'
import type { ReplayCircuit } from './circuit'
import {
  decodeBakedReplay,
  downsample,
  gapsByDriver,
  lapTimeline,
  lapsByDriver,
  replayWindow,
  stintsByDriver,
  traceOutline,
  usableLocations,
  weatherSamples,
} from './replay'
import type { BakedReplay, ReplayData, ReplayDriver, ReplayPosition } from './replay'
import { readReplayCache, writeReplayCache } from './replayCache'

export type ReplayPhase = 'session' | 'loading' | 'drivers' | 'positions' | 'circuit' | 'locations'

export interface ReplayProgress {
  phase: ReplayPhase
  label: string
  loaded: number
  total: number
}

export interface LoadReplayOptions {
  race: Race
  code: SessionCode
  signal?: AbortSignal
  onProgress?: (progress: ReplayProgress) => void
}

/** A session that cannot be replayed yet, as opposed to a request that failed. */
export class ReplayUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayUnavailableError'
  }
}

const BASE = import.meta.env.BASE_URL
/** How far around the scheduled slot to look for real coordinates. Race
 *  control can run early or late, and the clock in the metadata is only the
 *  scheduled time. */
const SESSION_SLACK_MS = 90 * 60_000

interface BakedIndexEntry {
  season: number
  code: SessionCode
  date: string
  sessionKey: number
}

let bakedIndex: Promise<BakedIndexEntry[] | null> | null = null

/**
 * The local season index, written by `npm run replays` next to the assets. It
 * maps jolpica's date and session code to an OpenF1 session key, so a baked
 * replay never has to ask OpenF1 `/sessions` what it is about to play.
 */
function loadBakedIndex(): Promise<BakedIndexEntry[] | null> {
  if (bakedIndex) return bakedIndex

  // Deliberately not tied to the dialog's abort signal: the file is tiny, the
  // lookup is shared by every replay, and an aborted first request (React
  // StrictMode mounts twice in development) must not poison the second mount.
  bakedIndex = fetch(`${BASE}replays/index.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((parsed: { sessions?: BakedIndexEntry[] } | null) =>
      Array.isArray(parsed?.sessions) ? parsed.sessions : null,
    )
    .catch(() => {
      // Do not memoise a failure: the next open should retry.
      bakedIndex = null
      return null
    })

  return bakedIndex
}

async function bakedSessionKey(race: Race, code: SessionCode): Promise<number | null> {
  const entries = await loadBakedIndex()
  if (!entries) return null

  const date = code === 'R' ? race.date : (race.Sprint?.date ?? race.date)
  const candidates = entries.filter(
    (entry) => String(entry.season) === race.season && entry.code === code,
  )

  const exact = candidates.find((entry) => entry.date === date)
  if (exact) return exact.sessionKey

  // Same timezone tolerance as `resolveSessionKey`: a late-night race can land
  // on a different UTC day in the two calendars.
  const wanted = Date.parse(`${date}T12:00:00Z`)
  let nearest: BakedIndexEntry | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const entry of candidates) {
    const distance = Math.abs(Date.parse(`${entry.date}T12:00:00Z`) - wanted)
    if (distance < nearestDistance) {
      nearest = entry
      nearestDistance = distance
    }
  }

  return nearest && nearestDistance <= 3 * 86_400_000 ? nearest.sessionKey : null
}

/**
 * One replay, from whichever source is available.
 *
 * The baked asset is tried first: one small static file, no third-party
 * runtime calls. When it is missing (a race baked after this deploy, or a local
 * dev checkout before `npm run replays`) the loader falls back to OpenF1,
 * throttled and with progress, and caches the result in IndexedDB.
 */
export async function loadReplay({
  race,
  code,
  signal,
  onProgress,
}: LoadReplayOptions): Promise<ReplayData> {
  const progress = (value: ReplayProgress) => onProgress?.(value)

  // Baked first, even when a fallback copy is cached: re-baking a race should
  // take effect without the visitor clearing IndexedDB. The local index gives
  // us the key without a third-party request.
  progress({ phase: 'loading', label: 'Loading replay…', loaded: 0, total: 1 })
  const indexed = await bakedSessionKey(race, code)
  signal?.throwIfAborted()

  if (indexed) {
    const baked = await loadBaked(indexed, signal)
    if (baked) return baked

    const cached = await readReplayCache(indexed)
    if (cached) {
      progress({ phase: 'loading', label: 'Loading replay…', loaded: 1, total: 1 })
      return cached
    }
  }

  progress({ phase: 'session', label: 'Finding the session…', loaded: 0, total: 1 })
  const resolved = await resolveSessionKey(race, code)
  if (!resolved) {
    throw new ReplayUnavailableError(
      'Replay is not available for this session yet. It needs a finished race or sprint.',
    )
  }

  signal?.throwIfAborted()

  // The index may be stale (or absent in a fresh deployment); try the resolved
  // key too, and only then reach for the network feeds.
  if (resolved.sessionKey !== indexed) {
    const baked = await loadBaked(resolved.sessionKey, signal)
    if (baked) return baked

    const cached = await readReplayCache(resolved.sessionKey)
    if (cached) {
      progress({ phase: 'loading', label: 'Loading replay…', loaded: 1, total: 1 })
      return cached
    }
  }

  return loadFromOpenF1({ race, code, ...resolved, signal, progress })
}

async function loadBaked(sessionKey: number, signal?: AbortSignal): Promise<ReplayData | null> {
  try {
    const response = await fetch(`${BASE}replays/${sessionKey}.json`, { signal })
    if (!response.ok) return null

    const baked = (await response.json()) as BakedReplay
    if (baked.v !== 1) return null
    return decodeBakedReplay(baked)
  } catch (cause) {
    if (signal?.aborted) throw cause
    return null
  }
}

interface LiveLoadOptions extends LoadReplayOptions {
  sessionKey: number
  circuitKey: number
  session: OpenF1Session
  progress: (progress: ReplayProgress) => void
}

async function loadFromOpenF1({
  race,
  code,
  sessionKey,
  circuitKey,
  session,
  signal,
  progress,
}: LiveLoadOptions): Promise<ReplayData> {
  progress({ phase: 'drivers', label: 'Loading the field…', loaded: 0, total: 3 })

  const drivers = await openf1.drivers(sessionKey, signal)
  signal?.throwIfAborted()

  progress({ phase: 'positions', label: 'Loading the standings…', loaded: 0, total: 1 })
  const positions = await openf1.positions(sessionKey, signal)
  signal?.throwIfAborted()

  // The lap feed supplies the race distance and the real start: the scheduled
  // time includes the formation lap, while location rows begin in the garage
  // about forty minutes before the session.
  let lapRows: OpenF1Lap[] = []
  let stintRows: OpenF1Stint[] = []
  let intervalRows: OpenF1Interval[] = []
  let weatherRows: OpenF1Weather[] = []
  let timeline: ReturnType<typeof lapTimeline> = null
  try {
    lapRows = await openf1.laps(sessionKey, signal)
    timeline = lapTimeline(lapRows)
  } catch (cause) {
    if (signal?.aborted) throw cause
  }
  signal?.throwIfAborted()

  try {
    stintRows = await openf1.stints(sessionKey, signal)
  } catch (cause) {
    if (signal?.aborted) throw cause
  }
  signal?.throwIfAborted()

  try {
    intervalRows = await openf1.intervals(sessionKey, signal)
  } catch (cause) {
    if (signal?.aborted) throw cause
  }
  signal?.throwIfAborted()

  try {
    weatherRows = await openf1.weather(sessionKey, signal)
  } catch (cause) {
    if (signal?.aborted) throw cause
  }
  signal?.throwIfAborted()

  const driverLaps = lapsByDriver(lapRows)
  const driverStints = stintsByDriver(stintRows)
  const driverGaps = gapsByDriver(intervalRows)

  progress({ phase: 'circuit', label: 'Loading the circuit…', loaded: 0, total: 1 })
  let info: Awaited<ReturnType<typeof openf1.circuit>> | null = null
  try {
    info = await openf1.circuit(circuitKey, session.year)
  } catch (cause) {
    if (signal?.aborted) throw cause
    // Madring and a few other circuits have no published geometry yet. The
    // cars can still be plotted, so continue and trace an outline later.
  }
  signal?.throwIfAborted()

  // The location feed opens in the garage about forty minutes before the
  // session and can carry a stray row from the day before. This generous fetch
  // window bounds every request; the lap feed later crops it to the race.
  const sessionStart = Date.parse(session.date_start)
  const sessionEnd = Date.parse(session.date_end)
  const fetchStart = Number.isFinite(sessionStart)
    ? sessionStart - SESSION_SLACK_MS
    : Date.now() - 24 * 3_600_000
  const fetchEnd = Number.isFinite(sessionEnd)
    ? sessionEnd + SESSION_SLACK_MS
    : Date.now()

  const replayDrivers: ReplayDriver[] = []
  let missing = 0

  for (let index = 0; index < drivers.length; index += 1) {
    const driver = drivers[index]
    progress({
      phase: 'locations',
      label: `Loading cars… ${index + 1}/${drivers.length}`,
      loaded: index,
      total: drivers.length,
    })

    try {
      const rows = await openf1.location(sessionKey, driver.driver_number, signal)
      const samples = downsample(usableLocations(rows, fetchStart, fetchEnd), 2)

      if (samples.length > 1) {
        replayDrivers.push({
          number: driver.driver_number,
          acronym: driver.name_acronym,
          name: driver.full_name,
          team: driver.team_name,
          color: driver.team_colour?.trim() ? `#${driver.team_colour.replace(/^#/, '')}` : '#7d786b',
          samples,
          laps: driverLaps.get(driver.driver_number),
          stints: driverStints.get(driver.driver_number),
          gaps: driverGaps.get(driver.driver_number),
        })
      } else {
        missing += 1
      }
    } catch (cause) {
      if (signal?.aborted) throw cause
      missing += 1
    }
  }

  if (replayDrivers.length === 0) {
    throw new Error('No car positions were available for this session.')
  }

  const window = replayWindow(replayDrivers)
  if (!window) throw new Error('No car positions were available for this session.')

  // Start at lights out, not at the first location row (garage) and not at the
  // scheduled slot (formation lap). The lap feed knows both; the scheduled time
  // is the fallback for a session without laps.
  const scheduledStart = Number.isFinite(sessionStart) ? sessionStart : null
  const start = timeline?.laps.starts[0]?.t ?? scheduledStart ?? window.start
  const end = timeline?.end && timeline.end > start ? timeline.end : window.end

  if (end <= start) throw new Error('No usable replay window was available for this session.')

  const conditions = weatherSamples(weatherRows, start, end)

  for (const driver of replayDrivers) {
    driver.samples = driver.samples.filter((sample) => sample.t >= start && sample.t <= end)
    const gaps = driver.gaps?.filter((sample) => sample.t >= start && sample.t <= end)
    driver.gaps = gaps?.length ? gaps : undefined
  }

  const playable = replayDrivers.filter((driver) => driver.samples.length > 1)
  missing += replayDrivers.length - playable.length

  if (playable.length === 0) {
    throw new Error('No car positions were available inside the race window.')
  }

  const outline = info
    ? info.x.map((x, index) => [x, info.y[index]] as const)
    : traceOutline(playable, start)

  if (outline.length < 3) {
    throw new Error('No circuit geometry was available for this session.')
  }

  const circuit: ReplayCircuit = {
    circuitKey,
    name: info?.circuitName ?? session.circuit_short_name,
    rotation: info?.rotation ?? 0,
    outline,
    approximate: info ? undefined : true,
  }

  // Keep the position records from before the replay start: the latest one at
  // `start` is the opening order, usually the starting grid.
  const replayPositions: ReplayPosition[] = []
  for (const row of positions) {
    if (row.position < 1) continue
    const t = Date.parse(row.date)
    if (!Number.isFinite(t) || t < fetchStart || t > end) continue

    let entry = replayPositions.find((item) => item.number === row.driver_number)
    if (!entry) {
      entry = { number: row.driver_number, samples: [] }
      replayPositions.push(entry)
    }
    entry.samples.push({ t, position: row.position })
  }

  for (const entry of replayPositions) {
    entry.samples.sort((a, b) => a.t - b.t)
  }

  progress({ phase: 'locations', label: 'Ready.', loaded: drivers.length, total: drivers.length })

  const data: ReplayData = {
    sessionKey,
    title: race.raceName,
    subtitle: `${session.circuit_short_name} · ${race.season} ${code === 'SR' ? 'Sprint' : 'Race'}`,
    circuit,
    drivers: playable,
    positions: replayPositions,
    start,
    end,
    laps: timeline?.laps,
    weather: conditions.length ? conditions : undefined,
    source: 'live',
    missing: missing > 0 ? missing : undefined,
  }

  if (missing === 0) await writeReplayCache(sessionKey, data)
  return data
}

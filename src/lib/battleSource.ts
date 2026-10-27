import { SHORT_REQUEST_GAP_MS, openf1, resolveSessionKey } from '../api/openf1'
import type { OpenF1CarData, OpenF1Driver, OpenF1Lap, OpenF1Location } from '../api/openf1'
import type { Race } from '../api/types'
import type { ReplayCircuit } from './circuit'
import { traceOutline } from './replay'
import { battleLaps, buildBattleLap, rankDrivers } from './battle'
import type {
  BattleDriver,
  BattleLap,
  BattleLapRef,
  QualifyingBattle,
} from './battle'
import { readBattleCache, writeBattleCache } from './battleCache'

/** The battle only exists for the two qualifying sessions. */
export type BattleCode = 'Q' | 'SQ'

export type BattlePhase =
  | 'session'
  | 'drivers'
  | 'laps'
  | 'circuit'
  | 'telemetry'
  | 'location'

export interface BattleProgress {
  phase: BattlePhase
  label: string
  loaded: number
  total: number
}

export interface BattleSession {
  sessionKey: number
  circuitKey: number
  season: string
  code: BattleCode
  title: string
  subtitle: string
  circuitName: string
  /** Null when Multiviewer has no geometry; the battle traces one from the cars. */
  circuit: ReplayCircuit | null
  /** Drivers with a timed lap, fastest first. */
  ranked: BattleDriver[]
  /** All ranked drivers, for straightforward lookup by number. */
  drivers: BattleDriver[]
  laps: Map<number, BattleLapRef[]>
}

export interface LoadBattleSessionOptions {
  race: Race
  code: BattleCode
  signal?: AbortSignal
  onProgress?: (progress: BattleProgress) => void
}

export interface LoadBattleOptions {
  session: BattleSession
  driverA: number
  lapA: number
  driverB: number
  lapB: number
  signal?: AbortSignal
  onProgress?: (progress: BattleProgress) => void
}

/** A session that cannot be compared, as opposed to a request that failed. */
export class BattleUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BattleUnavailableError'
  }
}

function toDriver(driver: OpenF1Driver): BattleDriver {
  return {
    number: driver.driver_number,
    acronym: driver.name_acronym,
    name: driver.full_name,
    team: driver.team_name,
    color: driver.team_colour?.trim()
      ? `#${driver.team_colour.replace(/^#/, '')}`
      : '#7d786b',
  }
}

/**
 * The data needed by the setup screen: the session, its drivers, every timed lap
 * and (when available) the circuit. No telemetry is fetched until the visitor
 * has picked two laps.
 */
export async function loadBattleSession({
  race,
  code,
  signal,
  onProgress,
}: LoadBattleSessionOptions): Promise<BattleSession> {
  const progress = (value: BattleProgress) => onProgress?.(value)

  progress({ phase: 'session', label: 'Finding the session…', loaded: 0, total: 4 })
  const resolved = await resolveSessionKey(race, code, SHORT_REQUEST_GAP_MS)
  if (!resolved) {
    throw new BattleUnavailableError(
      'The qualifying session for this round could not be found yet.',
    )
  }
  signal?.throwIfAborted()

  progress({ phase: 'drivers', label: 'Loading the field…', loaded: 1, total: 4 })
  const driverRows = await openf1.drivers(resolved.sessionKey, signal, SHORT_REQUEST_GAP_MS)
  signal?.throwIfAborted()

  progress({ phase: 'laps', label: 'Loading the laps…', loaded: 2, total: 4 })
  let lapRows: OpenF1Lap[] = []
  try {
    lapRows = await openf1.laps(resolved.sessionKey, signal, SHORT_REQUEST_GAP_MS)
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new BattleUnavailableError('The lap feed for this session could not be loaded.')
  }
  signal?.throwIfAborted()

  progress({ phase: 'circuit', label: 'Loading the circuit…', loaded: 3, total: 4 })
  let circuit: ReplayCircuit | null = null
  try {
    const info = await openf1.circuit(
      resolved.circuitKey,
      resolved.session.year,
      SHORT_REQUEST_GAP_MS,
    )
    if (info.x.length >= 3) {
      circuit = {
        circuitKey: resolved.circuitKey,
        name: info.circuitName ?? resolved.session.circuit_short_name,
        rotation: info.rotation,
        outline: info.x.map((x, index) => [x, info.y[index]] as const),
      }
    }
  } catch (cause) {
    if (signal?.aborted) throw cause
    // Madring and Kuala Lumpur have no published geometry. The battle traces
    // the driven line once it has the two laps, the same fallback as the replay.
  }
  signal?.throwIfAborted()

  const laps = battleLaps(lapRows)
  const ranked = rankDrivers(driverRows.map(toDriver), laps)

  if (ranked.length < 2) {
    throw new BattleUnavailableError(
      'This session needs at least two drivers with a timed lap to run a battle.',
    )
  }

  progress({ phase: 'circuit', label: 'Ready.', loaded: 4, total: 4 })

  return {
    sessionKey: resolved.sessionKey,
    circuitKey: resolved.circuitKey,
    season: race.season,
    code,
    title: race.raceName,
    subtitle: `${resolved.session.circuit_short_name} · ${race.season} ${
      code === 'SQ' ? 'Sprint Qualifying' : 'Qualifying'
    }`,
    circuitName: resolved.session.circuit_short_name,
    circuit,
    ranked,
    drivers: [...ranked],
    laps,
  }
}

function battleCacheKey(
  session: BattleSession,
  driverA: number,
  lapA: number,
  driverB: number,
  lapB: number,
): string {
  return `${session.sessionKey}:${driverA}:${lapA}:${driverB}:${lapB}`
}

/**
 * A traced outline from one battle lap. `traceOutline` works in epoch time, so
 * the lap's relative samples are lifted back onto their wall clock first.
 */
function tracedOutline(lap: BattleLap): Array<[number, number]> {
  const samples = lap.locations.map((sample) => ({
    t: lap.start + sample.t,
    x: sample.x,
    y: sample.y,
  }))

  return traceOutline([{ samples }], lap.start, lap.duration + 1_000)
}

async function fetchLap(
  session: BattleSession,
  driver: BattleDriver,
  ref: BattleLapRef,
  signal: AbortSignal | undefined,
  loadedBase: number,
  report: (loaded: number, phase: BattlePhase, label: string) => void,
): Promise<BattleLap | null> {
  // Pad the window so the sample on either side of the line is present. The
  // builder crops back to the exact lap once the rows are relative.
  const from = ref.start - 1_000
  const to = ref.start + ref.duration + 1_000

  report(loadedBase, 'telemetry', `Loading ${driver.acronym}'s telemetry…`)
  const carRows: OpenF1CarData[] = await openf1.carData(
    session.sessionKey,
    driver.number,
    from,
    to,
    signal,
  )
  signal?.throwIfAborted()

  report(loadedBase + 1, 'location', `Loading ${driver.acronym}'s track trace…`)
  const locationRows: OpenF1Location[] = await openf1.location(
    session.sessionKey,
    driver.number,
    signal,
    from,
    to,
  )
  signal?.throwIfAborted()

  return buildBattleLap(ref, carRows, locationRows)
}

/**
 * The two selected laps, their location feeds, and the circuit. The result is
 * small enough to cache whole; a repeat battle does not touch OpenF1 again.
 */
export async function loadBattle({
  session,
  driverA,
  lapA,
  driverB,
  lapB,
  signal,
  onProgress,
}: LoadBattleOptions): Promise<QualifyingBattle> {
  if (driverA === driverB) {
    throw new BattleUnavailableError('Pick two different drivers for a 1v1 battle.')
  }

  const key = battleCacheKey(session, driverA, lapA, driverB, lapB)
  const cached = await readBattleCache(key)
  if (cached) return cached

  const driverOne = session.drivers.find((driver) => driver.number === driverA)
  const driverTwo = session.drivers.find((driver) => driver.number === driverB)
  const refOne = session.laps.get(driverA)?.find((lap) => lap.lapNumber === lapA)
  const refTwo = session.laps.get(driverB)?.find((lap) => lap.lapNumber === lapB)

  if (!driverOne || !driverTwo || !refOne || !refTwo) {
    throw new BattleUnavailableError('One of the selected laps is no longer available.')
  }

  const report = (loaded: number, phase: BattlePhase, label: string) =>
    onProgress?.({ phase, label, loaded, total: 4 })

  const lapOne = await fetchLap(session, driverOne, refOne, signal, 0, report)
  const lapTwo = await fetchLap(session, driverTwo, refTwo, signal, 2, report)

  signal?.throwIfAborted()

  if (!lapOne) {
    throw new Error(
      `No telemetry was available for ${driverOne.acronym}'s lap ${refOne.lapNumber}.`,
    )
  }
  if (!lapTwo) {
    throw new Error(
      `No telemetry was available for ${driverTwo.acronym}'s lap ${refTwo.lapNumber}.`,
    )
  }

  let circuit = session.circuit
  if (!circuit) {
    const traced = [tracedOutline(lapOne), tracedOutline(lapTwo)].sort(
      (a, b) => b.length - a.length,
    )[0]

    if (!traced || traced.length < 3) {
      throw new Error('No circuit geometry was available for this battle.')
    }

    circuit = {
      circuitKey: session.circuitKey,
      name: session.circuitName,
      rotation: 0,
      outline: traced,
      approximate: true,
    }
  }

  const battle: QualifyingBattle = {
    sessionKey: session.sessionKey,
    title: session.title,
    subtitle: session.subtitle,
    circuit,
    a: { driver: driverOne, lap: lapOne },
    b: { driver: driverTwo, lap: lapTwo },
    source: 'OpenF1',
  }

  onProgress?.({ phase: 'location', label: 'Ready.', loaded: 4, total: 4 })
  await writeBattleCache(key, battle)
  return battle
}

import { sampleIndexAt } from './replay'
import type { ReplayCircuit } from './circuit'

/**
 * The qualifying battle engine: two laps normalised to lap-elapsed time.
 *
 * The race replay works in epoch milliseconds because the whole field shares one
 * clock. A battle cannot: the two laps were driven minutes apart. Every sample
 * here is relative to its own lap start, and the renderer only knows the shared
 * playhead, so the same code works for a lap from Q1 and one from Q3.
 *
 * No DOM and no fetching. `battleSource.ts` turns OpenF1 rows into these shapes.
 */

export interface BattleDriver {
  number: number
  acronym: string
  name: string
  team: string
  /** Hex colour with the hash, matching the race replay. */
  color: string
}

export interface BattleLapRow {
  driver_number: number
  lap_number: number
  date_start: string
  lap_duration?: number | null
  duration_sector_1?: number | null
  duration_sector_2?: number | null
  duration_sector_3?: number | null
  is_pit_out_lap?: boolean | null
}

/** A timed lap before its telemetry is loaded; what the picker shows. */
export interface BattleLapRef {
  driverNumber: number
  lapNumber: number
  /** Lap time in milliseconds. */
  duration: number
  /** Epoch milliseconds; OpenF1 documents this as approximate. */
  start: number
  /** Sector times in milliseconds, in order. */
  sectors: [number, number, number] | null
  pitOut: boolean
}

export interface BattleTelemetrySample {
  /** Milliseconds since the lap start. */
  t: number
  speed: number | null
  rpm: number | null
  /** Discrete: `telemetryAt` carries the previous value through a change. */
  gear: number | null
  throttle: number | null
  brake: boolean | null
  /** Raw OpenF1 DRS value: 8 eligible, 10/12/14 open, otherwise off. */
  drs: number | null
  /** Integrated distance since the start of the lap, in metres. */
  distance: number
}

export interface BattleLocationSample {
  /** Milliseconds since the lap start. */
  t: number
  x: number
  y: number
}

export interface BattleLap extends BattleLapRef {
  telemetry: BattleTelemetrySample[]
  locations: BattleLocationSample[]
  /** Total integrated distance for the lap, in metres. */
  distanceTotal: number
}

export interface BattleCarRow {
  date: string
  driver_number: number
  speed?: number | null
  rpm?: number | null
  n_gear?: number | null
  throttle?: number | null
  brake?: number | null
  drs?: number | null
}

export interface BattleLocationRow {
  date: string
  x: number
  y: number
}

export interface BattleSide {
  driver: BattleDriver
  lap: BattleLap
}

export interface QualifyingBattle {
  sessionKey: number
  title: string
  subtitle: string
  circuit: ReplayCircuit
  a: BattleSide
  b: BattleSide
  source: 'OpenF1'
}

export interface BattleState {
  a: BattleTelemetrySample
  b: BattleTelemetrySample
  progressA: number
  progressB: number
  /** The driver furthest round the lap at this playhead; null when level. */
  lead: 'a' | 'b' | null
  /** Absolute time gap at the shared point, in milliseconds. */
  gap: number
  /** Signed difference `a - b`, in milliseconds; negative means A is ahead. */
  delta: number
}

/** OpenF1 uses `100` for a pressed brake and `0` for a released one. */
const BRAKE_ON = 50

function millis(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 1_000)
    : null
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Timed, non-pit-out laps per driver, ordered by lap number.
 *
 * Out-laps are flagged by OpenF1 and dropped here. In-laps are not flagged, so
 * they remain in the list; sorting by lap time naturally puts them last, and the
 * picker is explicit about which lap is being compared.
 */
export function battleLaps(rows: readonly BattleLapRow[]): Map<number, BattleLapRef[]> {
  const byDriver = new Map<number, BattleLapRef[]>()

  for (const row of rows) {
    if (!Number.isFinite(row.lap_number) || row.lap_number < 1) continue
    if (row.is_pit_out_lap) continue

    const duration = millis(row.lap_duration)
    if (duration === null) continue

    const start = Date.parse(row.date_start)
    if (!Number.isFinite(start)) continue

    const sector1 = millis(row.duration_sector_1)
    const sector2 = millis(row.duration_sector_2)
    const sector3 = millis(row.duration_sector_3)

    const lap: BattleLapRef = {
      driverNumber: row.driver_number,
      lapNumber: row.lap_number,
      duration,
      start,
      sectors:
        sector1 !== null && sector2 !== null && sector3 !== null
          ? [sector1, sector2, sector3]
          : null,
      pitOut: false,
    }

    const laps = byDriver.get(row.driver_number)
    if (laps) laps.push(lap)
    else byDriver.set(row.driver_number, [lap])
  }

  for (const laps of byDriver.values()) {
    laps.sort((a, b) => a.lapNumber - b.lapNumber)
  }

  return byDriver
}

export function fastestLap(laps: readonly BattleLapRef[]): BattleLapRef | null {
  let best: BattleLapRef | null = null
  for (const lap of laps) {
    if (best === null || lap.duration < best.duration) best = lap
  }
  return best
}

/** Drivers with a timed lap, fastest first; the setup screen's default order. */
export function rankDrivers(
  drivers: readonly BattleDriver[],
  laps: ReadonlyMap<number, BattleLapRef[]>,
): BattleDriver[] {
  const ranked: Array<{ driver: BattleDriver; best: BattleLapRef }> = []

  for (const driver of drivers) {
    const best = fastestLap(laps.get(driver.number) ?? [])
    if (best) ranked.push({ driver, best })
  }

  return ranked
    .sort(
      (a, b) =>
        a.best.duration - b.best.duration ||
        a.driver.acronym.localeCompare(b.driver.acronym),
    )
    .map((entry) => entry.driver)
}

/**
 * Turns one lap ref and its date-bounded feeds into a battle lap.
 *
 * Samples are cropped to the lap, sorted, and anchored at 0 and at the lap
 * duration. The anchors matter: the first telemetry row usually lands ~270 ms
 * after the line (3.7 Hz), and without them the opening fraction of the lap
 * would be missing from the cockpit and the distance integral.
 */
export function buildBattleLap(
  ref: BattleLapRef,
  carRows: readonly BattleCarRow[],
  locationRows: readonly BattleLocationRow[],
): BattleLap | null {
  const start = ref.start

  const telemetry: BattleTelemetrySample[] = []

  for (const row of carRows) {
    const t = Date.parse(row.date) - start
    if (!Number.isFinite(t) || t < 0 || t > ref.duration) continue

    const speed = numberOrNull(row.speed)
    const rpm = numberOrNull(row.rpm)
    const gear = numberOrNull(row.n_gear)
    const throttle = numberOrNull(row.throttle)
    const brake =
      typeof row.brake === 'number' && Number.isFinite(row.brake)
        ? row.brake >= BRAKE_ON
        : null
    const drs = numberOrNull(row.drs)

    if (
      speed === null &&
      rpm === null &&
      gear === null &&
      throttle === null &&
      brake === null &&
      drs === null
    ) {
      continue
    }

    telemetry.push({ t, speed, rpm, gear, throttle, brake, drs, distance: 0 })
  }

  if (telemetry.length < 2) return null

  telemetry.sort((a, b) => a.t - b.t)

  const first = telemetry[0]
  if (first.t > 0) telemetry.unshift({ ...first, t: 0 })

  const last = telemetry[telemetry.length - 1]
  if (last.t < ref.duration) telemetry.push({ ...last, t: ref.duration })

  // Integrate speed to get a monotonic distance curve. The final value is only
  // used as a normaliser, so small GPS/timing differences do not accumulate
  // into a metres-accurate claim; the shared-point gap uses the curve's shape.
  let distance = 0
  for (let index = 0; index < telemetry.length; index += 1) {
    if (index > 0) {
      const before = telemetry[index - 1]
      const current = telemetry[index]
      const speed =
        before.speed !== null && current.speed !== null
          ? (before.speed + current.speed) / 2
          : (current.speed ?? before.speed)
      if (speed !== null) {
        distance += (speed / 3.6) * ((current.t - before.t) / 1_000)
      }
    }
    telemetry[index].distance = distance
  }

  if (distance <= 0) return null

  const locations: BattleLocationSample[] = []
  for (const row of locationRows) {
    const t = Date.parse(row.date) - start
    if (!Number.isFinite(t) || t < 0 || t > ref.duration) continue
    if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) continue
    // Garage and no-signal rows; the same guard the race replay uses.
    if (row.x === 0 && row.y === 0) continue

    locations.push({ t, x: row.x, y: row.y })
  }

  if (locations.length < 2) return null

  locations.sort((a, b) => a.t - b.t)

  const firstLocation = locations[0]
  if (firstLocation.t > 0) locations.unshift({ ...firstLocation, t: 0 })

  const lastLocation = locations[locations.length - 1]
  if (lastLocation.t < ref.duration) {
    locations.push({ ...lastLocation, t: ref.duration })
  }

  return {
    ...ref,
    telemetry,
    locations,
    distanceTotal: distance,
  }
}

function lerp(a: number | null, b: number | null, ratio: number): number | null {
  if (a === null) return b
  if (b === null) return a
  return a + (b - a) * ratio
}

/** The cockpit at `elapsed`; discrete channels keep the earlier sample. */
export function telemetryAt(lap: BattleLap, elapsed: number): BattleTelemetrySample {
  const t = clamp(elapsed, 0, lap.duration)
  const samples = lap.telemetry
  const index = sampleIndexAt(samples, t)

  if (index < 0) return samples[0]

  const before = samples[index]
  const after = samples[index + 1]
  if (!after || after.t <= before.t) return before

  const ratio = (t - before.t) / (after.t - before.t)

  return {
    t,
    speed: lerp(before.speed, after.speed, ratio),
    rpm: lerp(before.rpm, after.rpm, ratio),
    gear: before.gear ?? after.gear,
    throttle: lerp(before.throttle, after.throttle, ratio),
    brake: before.brake ?? after.brake,
    drs: before.drs ?? after.drs,
    distance: before.distance + (after.distance - before.distance) * ratio,
  }
}

/** The car on the map at `elapsed`, interpolated between location samples. */
export function locationAt(lap: BattleLap, elapsed: number): { x: number; y: number } | null {
  const locations = lap.locations
  if (locations.length === 0) return null

  const t = clamp(elapsed, 0, lap.duration)
  const index = sampleIndexAt(locations, t)
  if (index < 0) return locations[0]

  const before = locations[index]
  const after = locations[index + 1]
  if (!after || after.t <= before.t) return { x: before.x, y: before.y }

  const ratio = (t - before.t) / (after.t - before.t)
  return {
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
  }
}

/** Fraction of the lap completed at `elapsed`, from the integrated curve. */
export function lapProgressAt(lap: BattleLap, elapsed: number): number {
  return clamp(telemetryAt(lap, elapsed).distance / lap.distanceTotal, 0, 1)
}

/**
 * The elapsed time at which a lap first reached `progress` (0..1).
 *
 * Used to invert the distance curve: if both laps reached the same point at
 * different times, the difference is the ghost-style gap.
 */
export function timeAtProgress(lap: BattleLap, progress: number): number {
  const p = clamp(progress, 0, 1)
  if (p <= 0) return 0
  if (p >= 1) return lap.duration

  const target = p * lap.distanceTotal
  const samples = lap.telemetry

  let low = 0
  let high = samples.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (samples[mid].distance < target) low = mid + 1
    else high = mid
  }

  const after = samples[low]
  const before = samples[low - 1] ?? after
  const span = after.distance - before.distance
  const ratio = span > 0 ? (target - before.distance) / span : 0

  return before.t + (after.t - before.t) * ratio
}

/**
 * Everything the battle view needs at one playhead.
 *
 * The live gap is measured at the place on track the leading car has reached:
 * `timeA(point) - timeB(point)`. It starts at 0.000 at the line and converges on
 * the exact lap-time difference once both cars have finished, which keeps the
 * moving number consistent with the sector table at the end.
 */
export function battleStateAt(a: BattleLap, b: BattleLap, elapsed: number): BattleState {
  const sampleA = telemetryAt(a, elapsed)
  const sampleB = telemetryAt(b, elapsed)
  const progressA = clamp(sampleA.distance / a.distanceTotal, 0, 1)
  const progressB = clamp(sampleB.distance / b.distanceTotal, 0, 1)
  const progress = Math.max(progressA, progressB)

  const delta = timeAtProgress(a, progress) - timeAtProgress(b, progress)
  const gap = Math.abs(delta)

  return {
    a: sampleA,
    b: sampleB,
    progressA,
    progressB,
    lead: gap < 1 ? null : delta < 0 ? 'a' : 'b',
    gap,
    delta,
  }
}

export function battleDuration(a: BattleLap, b: BattleLap): number {
  return Math.max(a.duration, b.duration)
}

/** Exact sector deltas `a - b`, in milliseconds; null when either lap lacks splits. */
export function sectorDeltas(
  a: BattleLapRef,
  b: BattleLapRef,
): [number | null, number | null, number | null] {
  if (!a.sectors || !b.sectors) return [null, null, null]

  return [
    a.sectors[0] - b.sectors[0],
    a.sectors[1] - b.sectors[1],
    a.sectors[2] - b.sectors[2],
  ]
}

export function lapDelta(a: BattleLapRef, b: BattleLapRef): number {
  return a.duration - b.duration
}

/** `0.128` for a gap in milliseconds. */
export function formatBattleGap(millisValue: number): string {
  return (Math.max(0, millisValue) / 1_000).toFixed(3)
}

/** `-0.041`, `+0.128`, or `0.000`; used by the sector table. */
export function formatBattleDelta(millisValue: number): string {
  const seconds = millisValue / 1_000
  if (Math.abs(seconds) < 0.0005) return '0.000'
  return `${seconds < 0 ? '-' : '+'}${Math.abs(seconds).toFixed(3)}`
}

/** DRS is a flag, not a percentage: 8 means eligible, 10/12/14 mean open. */
export function drsState(value: number | null): 'on' | 'ready' | 'off' {
  if (value === 8) return 'ready'
  if (value === 10 || value === 12 || value === 14) return 'on'
  return 'off'
}

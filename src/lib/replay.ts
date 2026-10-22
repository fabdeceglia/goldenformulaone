import type { ReplayCircuit } from './circuit'

/**
 * The replay engine: timeline, interpolation and the standings tower. No DOM
 * and no fetching, so both the baked loader and the OpenF1 fallback feed it the
 * same shape and the renderer never knows where the data came from.
 */

export interface ReplaySample {
  /** Epoch milliseconds. */
  t: number
  /** Metres, in the circuit's frame. */
  x: number
  y: number
}

export type ReplayTyre = 'S' | 'M' | 'H' | 'I' | 'W' | '?'

export interface ReplayDriverLap {
  /** When the lap started, epoch milliseconds. */
  t: number
  lap: number
  /** Lap time in milliseconds; 0 when the API has no completed time. */
  duration: number
}

export interface ReplayStint {
  startLap: number
  endLap: number
  compound: ReplayTyre
}

export interface ReplayGapSample {
  t: number
  /** Gap to the car ahead in milliseconds; null when the feed has no value. */
  gap: number | null
}

export interface ReplayDriver {
  number: number
  acronym: string
  name: string
  team: string
  /** Hex colour without the hash, from OpenF1. */
  color: string
  samples: ReplaySample[]
  /** Completed lap times, ordered by lap. */
  laps?: ReplayDriverLap[]
  /** Tyre stints, ordered by lap. */
  stints?: ReplayStint[]
  /** Interval to the car ahead, ordered by time. */
  gaps?: ReplayGapSample[]
}

const TYRE_CODES: Record<string, ReplayTyre> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
}

const TYRE_LABELS: Record<ReplayTyre, string> = {
  S: 'Soft',
  M: 'Medium',
  H: 'Hard',
  I: 'Intermediate',
  W: 'Wet',
  '?': 'Unknown',
}

export function tyreCode(compound: string | null | undefined): ReplayTyre {
  return TYRE_CODES[compound?.trim().toUpperCase() ?? ''] ?? '?'
}

export function tyreLabel(compound: ReplayTyre): string {
  return TYRE_LABELS[compound]
}

export interface ReplayPositionSample {
  t: number
  position: number
}

export interface ReplayPosition {
  number: number
  samples: ReplayPositionSample[]
}

export type ReplaySource = 'baked' | 'live'

export interface ReplayLapStart {
  /** Lap number the race leader started at `t`. */
  lap: number
  t: number
}

export interface ReplayLaps {
  /** Race distance, from the highest lap number in the feed. */
  total: number
  /** Ordered by lap; the first entry is lap 1, i.e. lights out. */
  starts: ReplayLapStart[]
}

export interface ReplayData {
  sessionKey: number
  title: string
  subtitle?: string
  circuit: ReplayCircuit
  drivers: ReplayDriver[]
  positions: ReplayPosition[]
  /** First and last moment of the replay, epoch milliseconds. */
  start: number
  end: number
  /** Lap count and the moments each leader lap began, when available. */
  laps?: ReplayLaps
  source: ReplaySource
  /** Drivers whose feed could not be fetched; the replay still plays. */
  missing?: number
}

/** The leader's lap at `t`, from the timestamped lap starts. */
export function lapAt(laps: ReplayLaps | undefined, t: number): number | null {
  if (!laps || laps.starts.length === 0) return null

  let low = 0
  let high = laps.starts.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (laps.starts[mid].t <= t) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return found < 0 ? null : laps.starts[found].lap
}

/** Index of the latest sample at or before `t`, or `-1` before the first one. */
export function sampleIndexAt(samples: readonly { t: number }[], t: number): number {
  if (samples.length === 0 || t < samples[0].t) return -1

  let low = 0
  let high = samples.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (samples[mid].t <= t) low = mid + 1
    else high = mid - 1
  }

  return high
}

/** Latest sample at or before `t`, or `null` when `t` is before the first one. */
export function sampleAt<T extends { t: number }>(
  samples: readonly T[],
  t: number,
): T | null {
  const index = sampleIndexAt(samples, t)
  return index < 0 ? null : samples[index]
}

/**
 * Index of the stint covering `lap`. A lap past the last stint (a retired car)
 * keeps the last stint it started; `-1` means the lap is before the first one.
 */
function stintIndexForLap(stints: readonly ReplayStint[] | undefined, lap: number): number {
  if (!stints) return -1
  let index = -1
  for (let stint = 0; stint < stints.length; stint += 1) {
    if (stints[stint].startLap > lap) break
    index = stint
  }
  return index
}

export interface DriverTiming {
  /** The last completed lap at `t`, in milliseconds. */
  lapTime: number | null
  /** The tyre the driver is on at `t`. */
  compound: ReplayTyre | null
  /** Completed pit stops up to the current lap; null without stint or lap data. */
  pitStops: number | null
}

/**
 * The timing-tower facts for a driver at `t`: the last completed lap time and
 * the tyre for the lap currently in progress. A lap is only shown once its end
 * time has passed, so the replay never reveals a time before it happened.
 */
export function driverTimingAt(driver: ReplayDriver, t: number): DriverTiming {
  const laps = driver.laps
  if (!laps || laps.length === 0) return { lapTime: null, compound: null, pitStops: null }

  const currentIndex = sampleIndexAt(laps, t)
  if (currentIndex < 0) return { lapTime: null, compound: null, pitStops: null }

  const stintIndex = stintIndexForLap(driver.stints, laps[currentIndex].lap)
  const compound = driver.stints?.[stintIndex]?.compound ?? null
  const pitStops = stintIndex >= 0 ? stintIndex : null

  for (let index = currentIndex; index >= 0; index -= 1) {
    const lap = laps[index]
    if (lap.duration > 0 && lap.t + lap.duration <= t) {
      return { lapTime: lap.duration, compound, pitStops }
    }
  }

  return { lapTime: null, compound, pitStops }
}

/**
 * The latest gap to the car ahead at `t`. A momentarily missing interval falls
 * back to the previous one for up to thirty seconds instead of blanking.
 */
export function gapAt(driver: ReplayDriver, t: number): number | null {
  const gaps = driver.gaps
  if (!gaps?.length) return null

  const latest = sampleAt(gaps, t)
  if (!latest || t - latest.t > 120_000) return null

  for (let index = sampleIndexAt(gaps, t); index >= 0; index -= 1) {
    const sample = gaps[index]
    if (sample.gap !== null) return sample.gap
    if (t - sample.t > 30_000) break
  }
  return null
}

/**
 * A car's position at `t`, interpolated between the two bracketing samples.
 * A car that has not sent a point for a few seconds is treated as gone rather
 * than left parked at its last location.
 */
export function interpolatePosition(
  driver: ReplayDriver,
  t: number,
): { x: number; y: number } | null {
  const samples = driver.samples
  if (samples.length === 0) return null
  if (t < samples[0].t - 3_000) return null
  if (t > samples[samples.length - 1].t + 8_000) return null

  if (t <= samples[0].t) return samples[0]

  const index = sampleIndexAt(samples, t)
  if (index < 0) return samples[0]

  const before = samples[index]
  const after = samples[index + 1]
  if (!after || after.t === before.t) return before

  const ratio = (t - before.t) / (after.t - before.t)
  return {
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
  }
}

export interface Standing {
  position: number
  driver: ReplayDriver
}

/**
 * The tower order at `t`: the latest position record for each car, sorted. The
 * API records a position only when it changes, so this reorders itself through
 * an overtake without any extra data.
 */
export function standingsAt(data: ReplayData, t: number): Standing[] {
  const byNumber = new Map(data.drivers.map((driver) => [driver.number, driver]))
  const entries: Standing[] = []

  for (const position of data.positions) {
    const driver = byNumber.get(position.number)
    if (!driver) continue

    const latest = sampleAt(position.samples, t)
    // Before a driver's first record, use its earliest known position rather
    // than showing an empty tower row.
    const value = latest ?? position.samples[0]
    if (!value) continue

    entries.push({ position: value.position, driver })
  }

  return entries.sort((a, b) => a.position - b.position || a.driver.number - b.driver.number)
}

/** `1:38.942`, or `58.123` for a lap under a minute. */
export function formatLapTime(millis: number): string {
  const total = Math.max(0, Math.round(millis))
  const minutes = Math.floor(total / 60_000)
  const seconds = (total % 60_000) / 1_000
  return minutes > 0
    ? `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
    : seconds.toFixed(3)
}

/** `+0.382`, `+12.3`, `+1:02.3`, or `+1 LAP` for a gap beyond two minutes. */
export function formatInterval(millis: number): string {
  const total = Math.max(0, Math.round(millis))
  if (total >= 120_000) return '+1 LAP'
  if (total >= 60_000) {
    const minutes = Math.floor(total / 60_000)
    const seconds = ((total % 60_000) / 1_000).toFixed(1).padStart(4, '0')
    return `+${minutes}:${seconds}`
  }
  return total >= 10_000 ? `+${(total / 1_000).toFixed(1)}` : `+${(total / 1_000).toFixed(3)}`
}

/** `92:14`, or `1:02:14` once a replay runs past the hour. */
export function formatReplayClock(millis: number): string {
  const total = Math.max(0, Math.round(millis / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/**
 * Turns OpenF1's per-driver lap rows into one leader timeline: each lap starts
 * when the first car crosses the line, and the race ends with the last recorded
 * lap. The first entry is the race start — not the scheduled session start,
 * which can be minutes earlier (formation lap) or later (a delayed start).
 */
export function lapTimeline(
  rows: ReadonlyArray<{
    lap_number: number
    date_start: string
    lap_duration?: number | null
  }>,
): { laps: ReplayLaps; end: number | null } | null {
  const starts = new Map<number, number>()
  let end = Number.NEGATIVE_INFINITY

  for (const row of rows) {
    if (!Number.isFinite(row.lap_number) || row.lap_number < 1) continue
    const t = Date.parse(row.date_start)
    if (!Number.isFinite(t)) continue

    const current = starts.get(row.lap_number)
    if (current === undefined || t < current) starts.set(row.lap_number, t)

    const duration = Number(row.lap_duration)
    if (Number.isFinite(duration) && duration > 0) {
      end = Math.max(end, t + duration * 1_000)
    }
  }

  if (starts.size === 0) return null

  const ordered = [...starts]
    .sort(([a], [b]) => a - b)
    .map(([lap, t]) => ({ lap, t }))

  return {
    laps: { total: ordered[ordered.length - 1].lap, starts: ordered },
    end: Number.isFinite(end) ? end : null,
  }
}

/** Completed-lap timing for every driver, from one `/laps?session_key=` call. */
export function lapsByDriver(
  rows: ReadonlyArray<{
    driver_number: number
    lap_number: number
    date_start: string
    lap_duration?: number | null
  }>,
): Map<number, ReplayDriverLap[]> {
  const byDriver = new Map<number, ReplayDriverLap[]>()

  for (const row of rows) {
    if (!Number.isFinite(row.lap_number) || row.lap_number < 1) continue
    const t = Date.parse(row.date_start)
    if (!Number.isFinite(t)) continue

    const duration = Number(row.lap_duration)
    const lap: ReplayDriverLap = {
      t,
      lap: row.lap_number,
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1_000) : 0,
    }

    const laps = byDriver.get(row.driver_number)
    if (laps) laps.push(lap)
    else byDriver.set(row.driver_number, [lap])
  }

  for (const laps of byDriver.values()) {
    laps.sort((a, b) => a.lap - b.lap)
  }

  return byDriver
}

/** Tyre stints for every driver, from one `/stints?session_key=` call. */
export function stintsByDriver(
  rows: ReadonlyArray<{
    driver_number: number
    lap_start: number
    lap_end: number
    compound: string
  }>,
): Map<number, ReplayStint[]> {
  const byDriver = new Map<number, ReplayStint[]>()

  for (const row of rows) {
    if (!Number.isFinite(row.lap_start) || !Number.isFinite(row.lap_end)) continue
    if (row.lap_end < row.lap_start) continue

    const stint: ReplayStint = {
      startLap: row.lap_start,
      endLap: row.lap_end,
      compound: tyreCode(row.compound),
    }

    const stints = byDriver.get(row.driver_number)
    if (stints) stints.push(stint)
    else byDriver.set(row.driver_number, [stint])
  }

  for (const stints of byDriver.values()) {
    stints.sort((a, b) => a.startLap - b.startLap)
  }

  return byDriver
}

function intervalMillis(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const seconds = typeof value === 'string' && value.trim() === '' ? NaN : Number(value)
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1_000)) : null
}

/** Gaps to the car ahead for every driver, from one `/intervals?session_key=` call. */
export function gapsByDriver(
  rows: ReadonlyArray<{
    date: string
    driver_number: number
    interval?: number | string | null
  }>,
): Map<number, ReplayGapSample[]> {
  const byDriver = new Map<number, ReplayGapSample[]>()

  for (const row of rows) {
    const t = Date.parse(row.date)
    if (!Number.isFinite(t)) continue

    const sample: ReplayGapSample = { t, gap: intervalMillis(row.interval) }
    const gaps = byDriver.get(row.driver_number)
    if (gaps) gaps.push(sample)
    else byDriver.set(row.driver_number, [sample])
  }

  for (const gaps of byDriver.values()) {
    gaps.sort((a, b) => a.t - b.t)
  }

  return byDriver
}

/* ---------- Baked asset format ---------- */

/**
 * The static replay file is JSON, but coordinates are stored as base36 deltas
 * in one string per driver. A raw `[t, x, y]` array triple is about three times
 * the size and gzips less well, and a full field at 2 Hz is a lot of triples.
 */
export interface BakedReplayDriver {
  n: number
  a: string
  name: string
  team: string
  c?: string
  /** `dt.dx.dy` frames, all base36; dt in deciseconds, dx/dy in metres. */
  s: string
  /** `dt.duration.lap` frames, base36; dt in deciseconds, duration in milliseconds. */
  l?: string
  /** `startLap-endLap:compound` stints, comma-separated. */
  t?: string
  /** `dt.gap` frames, base36; dt in deciseconds, gap in milliseconds, 0 = unknown. */
  g?: string
}

export interface BakedReplayPosition {
  n: number
  /** `dt.position` frames, base36; dt in deciseconds. */
  s: string
}

export interface BakedReplay {
  v: 1
  sessionKey: number
  title: string
  subtitle?: string
  circuit: ReplayCircuit
  start: number
  end: number
  /** `dt.lap` frames, base36; dt in deciseconds from the replay start. */
  laps?: { total: number; starts: string }
  drivers: BakedReplayDriver[]
  positions: BakedReplayPosition[]
}

function base36(value: number): string {
  return Math.max(0, Math.round(value)).toString(36)
}

function fromBase36(value: string): number {
  return parseInt(value, 36) || 0
}

/** Zigzag keeps negative deltas one character shorter than a sign would. */
export function zigzag(value: number): number {
  return value < 0 ? -value * 2 - 1 : value * 2
}

export function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2
}

/** Encodes samples relative to the replay start; used by the bake script. */
export function encodeLocationSamples(samples: readonly ReplaySample[], start: number): string {
  if (samples.length === 0) return ''

  let previousT = start
  let previousX = 0
  let previousY = 0
  const frames: string[] = []

  for (const sample of samples) {
    const dt = Math.round((sample.t - previousT) / 100)
    const dx = Math.round(sample.x) - previousX
    const dy = Math.round(sample.y) - previousY
    frames.push(`${base36(dt)}.${base36(zigzag(dx))}.${base36(zigzag(dy))}`)
    previousT = sample.t
    previousX = Math.round(sample.x)
    previousY = Math.round(sample.y)
  }

  return frames.join(',')
}

function decodeLocationSamples(encoded: string, start: number): ReplaySample[] {
  if (!encoded) return []

  let t = start
  let x = 0
  let y = 0
  const samples: ReplaySample[] = []

  for (const frame of encoded.split(',')) {
    const [dt, dx, dy] = frame.split('.')
    t += fromBase36(dt) * 100
    x += unzigzag(fromBase36(dx))
    y += unzigzag(fromBase36(dy))
    samples.push({ t, x, y })
  }

  return samples
}

export function decodeBakedReplay(baked: BakedReplay): ReplayData {
  return {
    sessionKey: baked.sessionKey,
    title: baked.title,
    subtitle: baked.subtitle,
    circuit: baked.circuit,
    start: baked.start,
    end: baked.end,
    laps: baked.laps
      ? {
          total: baked.laps.total,
          starts: decodeLapStarts(baked.laps.starts, baked.start),
        }
      : undefined,
    source: 'baked',
    drivers: baked.drivers.map((driver) => ({
      number: driver.n,
      acronym: driver.a,
      name: driver.name,
      team: driver.team,
      color: driver.c?.trim() ? `#${driver.c.replace(/^#/, '')}` : '#7d786b',
      samples: decodeLocationSamples(driver.s, baked.start),
      laps: driver.l ? decodeDriverLaps(driver.l, baked.start) : undefined,
      stints: driver.t ? decodeDriverStints(driver.t) : undefined,
      gaps: driver.g ? decodeDriverGaps(driver.g, baked.start) : undefined,
    })),
    positions: baked.positions.map((position) => ({
      number: position.n,
      samples: decodePositionSamples(position.s, baked.start),
    })),
  }
}

function decodePositionSamples(encoded: string, start: number): ReplayPositionSample[] {
  if (!encoded) return []

  let t = start
  const samples: ReplayPositionSample[] = []
  for (const frame of encoded.split(',')) {
    const [dt, position] = frame.split('.')
    t += fromBase36(dt) * 100
    samples.push({ t, position: fromBase36(position) })
  }
  return samples
}

function decodeDriverLaps(encoded: string, start: number): ReplayDriverLap[] {
  if (!encoded) return []

  let t = start
  const laps: ReplayDriverLap[] = []
  for (const frame of encoded.split(',')) {
    const [dt, duration, lap] = frame.split('.')
    t += fromBase36(dt) * 100
    laps.push({
      t,
      lap: fromBase36(lap),
      duration: fromBase36(duration),
    })
  }
  return laps
}

function decodeDriverStints(encoded: string): ReplayStint[] {
  if (!encoded) return []

  const stints: ReplayStint[] = []
  for (const frame of encoded.split(',')) {
    const [range, compound] = frame.split(':')
    const [startLap, endLap] = range.split('-')
    stints.push({
      startLap: Number(startLap),
      endLap: Number(endLap),
      compound: (compound || '?') as ReplayTyre,
    })
  }
  return stints
}

function decodeDriverGaps(encoded: string, start: number): ReplayGapSample[] {
  if (!encoded) return []

  let t = start
  const gaps: ReplayGapSample[] = []
  for (const frame of encoded.split(',')) {
    const [dt, gap] = frame.split('.')
    t += fromBase36(dt) * 100
    const value = fromBase36(gap)
    gaps.push({ t, gap: value === 0 ? null : value - 1 })
  }
  return gaps
}

/** Encodes a driver's gap timeline; used by the bake script. */
export function encodeDriverGaps(gaps: readonly ReplayGapSample[], start: number): string {
  let previousT = start
  return gaps
    .map((sample) => {
      const dt = Math.round((sample.t - previousT) / 100)
      previousT = sample.t
      const gap = sample.gap === null ? 0 : Math.max(0, Math.round(sample.gap)) + 1
      return `${base36(dt)}.${base36(gap)}`
    })
    .join(',')
}

/** Encodes a driver's lap timing; used by the bake script. */
export function encodeDriverLaps(
  laps: readonly ReplayDriverLap[],
  start: number,
): string {
  let previousT = start
  return laps
    .map((lap) => {
      const dt = Math.round((lap.t - previousT) / 100)
      previousT = lap.t
      return `${base36(dt)}.${base36(lap.duration)}.${base36(lap.lap)}`
    })
    .join(',')
}

/** Encodes a driver's tyre stints; used by the bake script. */
export function encodeDriverStints(stints: readonly ReplayStint[]): string {
  return stints.map((stint) => `${stint.startLap}-${stint.endLap}:${stint.compound}`).join(',')
}

/** Encodes leader lap starts relative to the replay start; used by the bake script. */
export function encodeLapStarts(starts: readonly ReplayLapStart[], start: number): string {
  let previousT = start
  const frames: string[] = []

  for (const entry of starts) {
    const dt = Math.round((entry.t - previousT) / 100)
    frames.push(`${base36(dt)}.${base36(entry.lap)}`)
    previousT = entry.t
  }

  return frames.join(',')
}

function decodeLapStarts(encoded: string, start: number): ReplayLapStart[] {
  if (!encoded) return []

  let t = start
  const starts: ReplayLapStart[] = []
  for (const frame of encoded.split(',')) {
    const [dt, lap] = frame.split('.')
    t += fromBase36(dt) * 100
    starts.push({ lap: fromBase36(lap), t })
  }
  return starts
}

/* ---------- Ingest helpers (OpenF1 fallback and the bake script) ---------- */

/** Location rows inside the race window, without garage/no-signal zeros. */
export function usableLocations(
  rows: ReadonlyArray<{ date: string; x: number; y: number }>,
  windowStart: number,
  windowEnd: number,
): ReplaySample[] {
  const samples: ReplaySample[] = []

  for (const row of rows) {
    const t = Date.parse(row.date)
    if (!Number.isFinite(t) || t < windowStart || t > windowEnd) continue
    if (row.x === 0 && row.y === 0) continue
    samples.push({ t, x: row.x, y: row.y })
  }

  samples.sort((a, b) => a.t - b.t)
  return samples
}

/**
 * Keeps at most one point per interval, plus the final point. The feed is
 * roughly 3–4 Hz; 2 Hz is smooth under interpolation and halves the file.
 */
export function downsample(samples: readonly ReplaySample[], hz = 2): ReplaySample[] {
  if (samples.length <= 2) return [...samples]

  const interval = 1_000 / hz
  const kept: ReplaySample[] = [samples[0]]
  let lastKept = samples[0].t

  for (let index = 1; index < samples.length - 1; index += 1) {
    if (samples[index].t - lastKept >= interval) {
      kept.push(samples[index])
      lastKept = samples[index].t
    }
  }

  const last = samples[samples.length - 1]
  if (kept[kept.length - 1].t !== last.t) kept.push(last)
  return kept
}

/**
 * A circuit outline traced from one car's first lap.
 *
 * A handful of rounds have no published geometry — Madring is the current
 * example, and OpenF1 links to a Multiviewer endpoint that returns 404. Rather
 * than refusing to replay those races, the bake script (and the live fallback)
 * can draw the line the cars actually took. It is a racing line rather than the
 * official track edge, so `prepareCircuit` marks it approximate.
 */
export function traceOutline(
  drivers: ReadonlyArray<Pick<ReplayDriver, 'samples'>>,
  start: number,
  duration = 200_000,
): Array<[number, number]> {
  const inWindow = drivers
    .map((driver) =>
      driver.samples.filter((sample) => sample.t >= start && sample.t <= start + duration),
    )
    .filter((samples) => samples.length > 20)
    .sort((a, b) => b.length - a.length)

  const samples = inWindow[0]
  if (!samples) return []

  const first = samples[0]
  const firstAt = first.t

  // Cut where the car comes back round to where it started, so the map closes
  // cleanly instead of drawing a second lap on top of the first. A lap takes at
  // least a minute even at Madring.
  let cut = samples.length
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    if (sample.t - firstAt < 60_000) continue
    const distance = Math.hypot(sample.x - first.x, sample.y - first.y)
    if (distance < 80) {
      cut = index + 1
      break
    }
  }

  const points: Array<[number, number]> = []
  let lastX = Number.NaN
  let lastY = Number.NaN
  for (const sample of samples.slice(0, cut)) {
    if (!Number.isNaN(lastX) && Math.hypot(sample.x - lastX, sample.y - lastY) < 25) continue
    points.push([sample.x, sample.y])
    lastX = sample.x
    lastY = sample.y
  }

  return points
}

/**
 * The window the replay should actually play.
 *
 * Using the first coordinate in the whole field is too eager: GPS can lock on
 * for a couple of cars minutes before the rest (Singapore's first samples were
 * spread over four minutes). Starting when nine in ten cars have a coordinate
 * means the map opens with the field on track; the stragglers appear when their
 * own feed starts. The last sample of the slowest car is the flag.
 */
export function replayWindow(
  drivers: ReadonlyArray<Pick<ReplayDriver, 'samples'>>,
): { start: number; end: number } | null {
  const starts = drivers
    .map((driver) => driver.samples[0]?.t)
    .filter((t): t is number => Number.isFinite(t))
    .sort((a, b) => a - b)
  const ends = drivers
    .map((driver) => driver.samples[driver.samples.length - 1]?.t)
    .filter((t): t is number => Number.isFinite(t))
    .sort((a, b) => a - b)

  if (starts.length === 0 || ends.length === 0) return null

  const start = starts[Math.floor((starts.length - 1) * 0.9)] ?? starts[0]
  const end = ends[ends.length - 1]
  return end > start ? { start, end } : null
}

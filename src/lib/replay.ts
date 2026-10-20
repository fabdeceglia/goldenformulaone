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

export interface ReplayDriver {
  number: number
  acronym: string
  name: string
  team: string
  /** Hex colour without the hash, from OpenF1. */
  color: string
  samples: ReplaySample[]
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
  source: ReplaySource
  /** Drivers whose feed could not be fetched; the replay still plays. */
  missing?: number
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
    // Before the first record (the grid formation lap) use the opening order
    // rather than showing an empty tower.
    const value = latest ?? position.samples[0]
    if (!value) continue

    entries.push({ position: value.position, driver })
  }

  return entries.sort((a, b) => a.position - b.position || a.driver.number - b.driver.number)
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
    source: 'baked',
    drivers: baked.drivers.map((driver) => ({
      number: driver.n,
      acronym: driver.a,
      name: driver.name,
      team: driver.team,
      color: driver.c?.trim() ? `#${driver.c.replace(/^#/, '')}` : '#7d786b',
      samples: decodeLocationSamples(driver.s, baked.start),
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

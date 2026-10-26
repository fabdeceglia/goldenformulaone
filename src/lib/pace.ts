import type { ReplayData, ReplayDriver } from './replay'

/**
 * Race-pace data for the pace tab. This is a pure projection of the lap rows
 * already in the replay payload: one point per completed lap, placed at the
 * moment the lap ended.
 */

export interface PacePoint {
  /** Elapsed race time in milliseconds, at the end of the lap. */
  t: number
  /** Completed lap time in milliseconds. */
  time: number
  /** Lap number, for tooltips and labels. */
  lap: number
}

export interface PaceSeries {
  driver: ReplayDriver
  points: PacePoint[]
  /** Fastest clean lap in milliseconds. */
  best: number
  /** Median clean lap in milliseconds. */
  median: number
}

/**
 * Laps this much slower than a driver's median are pit in/out laps, laps behind
 * a safety car, or another interruption. They are left out of the pace graph so
 * a pit stop does not squash every racing lap into the bottom of the axis.
 */
const OUTLIER_FACTOR = 1.05

function medianOf(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/**
 * One series per driver that has usable lap timing, fastest median first.
 * `duration === 0` is the feed's "no time" value for the opening lap and the
 * final partial lap, so those rows are skipped.
 */
export function racePace(data: ReplayData): PaceSeries[] {
  const series: PaceSeries[] = []
  const duration = Math.max(1, data.end - data.start)

  for (const driver of data.drivers) {
    const timed = driver.laps?.filter((lap) => lap.duration > 0) ?? []
    if (timed.length === 0) continue

    const sorted = timed.map((lap) => lap.duration).sort((a, b) => a - b)
    const median = medianOf(sorted)

    // A retirement or a red-flagged session can leave a driver with only a
    // handful of laps; trimming those would hide real data, so only filter
    // once there is enough of a sample to establish a median pace.
    const cutoff = timed.length >= 4 ? median * OUTLIER_FACTOR : Number.POSITIVE_INFINITY

    const points = timed
      .filter((lap) => lap.duration <= cutoff)
      .map((lap) => ({
        t: Math.min(duration, Math.max(0, lap.t + lap.duration - data.start)),
        time: lap.duration,
        lap: lap.lap,
      }))
      .sort((a, b) => a.t - b.t)

    if (points.length === 0) continue

    series.push({
      driver,
      points,
      best: sorted[0],
      median,
    })
  }

  return series.sort((a, b) => a.median - b.median || a.driver.number - b.driver.number)
}

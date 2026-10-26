import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { smoothPath } from '../lib/curve'
import { racePace } from '../lib/pace'
import type { PacePoint, PaceSeries } from '../lib/pace'
import { formatLapTime, lapAt } from '../lib/replay'
import type { ReplayData } from '../lib/replay'
import { Empty } from './Feedback'

interface ReplayPaceProps {
  data: ReplayData
  /** Replay playhead, epoch milliseconds; the chart maps it to lap progress. */
  current: number
  /** Empty means every driver; otherwise only these driver numbers are drawn. */
  selected: ReadonlySet<number>
  onToggleDriver: (number: number) => void
  onResetFilter: () => void
}

const INITIAL_WIDTH = 960
const MIN_CHART_WIDTH = 300
const MIN_CHART_HEIGHT = 260
const MAX_CHART_HEIGHT = 420

/**
 * Race pace as one line per driver across the race distance. The axes are lap
 * number and completed lap time; a lap is plotted on its own lap number once
 * its end time is known. The filter chips mirror the standings tower: an empty
 * selection shows the whole field.
 */
export function ReplayPace({
  data,
  current,
  selected,
  onToggleDriver,
  onResetFilter,
}: ReplayPaceProps) {
  const series = useMemo(() => racePace(data), [data])
  const totalLaps = useMemo(() => {
    let maxLap = 1
    for (const entry of series) {
      for (const point of entry.points) maxLap = Math.max(maxLap, point.lap)
    }
    return Math.max(1, maxLap, data.laps?.total ?? 0)
  }, [series, data.laps])
  const [hovered, setHovered] = useState<number | null>(null)
  // The dot tooltip is keyed by driver and lap rather than by a chart position,
  // so it follows the point across resizes and can be validated against what is
  // currently drawn instead of drifting away from a removed lap.
  const [dotHover, setDotHover] = useState<{ driver: number; lap: number } | null>(null)

  const shellRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(INITIAL_WIDTH)

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const measure = () => {
      const styles = window.getComputedStyle(shell)
      const padding =
        (Number.parseFloat(styles.paddingLeft) || 0) +
        (Number.parseFloat(styles.paddingRight) || 0)
      setWidth(Math.max(MIN_CHART_WIDTH, shell.clientWidth - padding))
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [])

  const duration = Math.max(1, data.end - data.start)
  const filterActive = selected.size > 0
  const visible = useMemo(
    () => (filterActive ? series.filter((entry) => selected.has(entry.driver.number)) : series),
    [series, filterActive, selected],
  )
  // Scale the y-axis to the drivers on screen, but always from their complete
  // lap set so the graph does not rescale while the replay fills it in. An
  // invisible driver's outlier should not squash the filtered view.
  const chart = useMemo(
    () => buildChart(visible.length > 0 ? visible : series, totalLaps, width),
    [visible, series, totalLaps, width],
  )

  // The graph is a live view, like the map: a lap only enters it once the
  // playhead has passed the lap's end. The axis stays fixed for the whole race,
  // so the lines extend rather than the chart rescaling around them.
  const elapsed = Math.max(0, current - data.start)
  const currentLap = lapAt(data.laps, current)
  const playheadLap = useMemo(() => {
    const starts = data.laps?.starts
    if (!starts || starts.length === 0) {
      return duration > 0
        ? Math.min(totalLaps, Math.max(0, (elapsed / duration) * totalLaps))
        : 0
    }

    const lap = currentLap ?? starts[0].lap
    let index = starts.findIndex((entry) => entry.lap === lap)
    if (index < 0) index = 0
    const start = starts[index].t
    const next = starts[index + 1]?.t ?? data.end
    const span = next - start
    const progress = span > 0 ? Math.min(1, Math.max(0, (current - start) / span)) : 1
    return Math.min(totalLaps, Math.max(0, lap - 1 + progress))
  }, [current, currentLap, data.end, data.laps, duration, elapsed, totalLaps])

  const revealed = useMemo(() => {
    const entries: Array<{ series: PaceSeries; points: PacePoint[]; path: string }> = []
    for (const entry of visible) {
      const points = entry.points.filter((point) => point.t <= elapsed)
      if (points.length === 0) continue
      entries.push({ series: entry, points, path: pacePath(points, chart.x, chart.y) })
    }
    return entries
  }, [visible, elapsed, chart])

  // Resolve the hovered dot against the current drawing so a lap that the
  // playhead has not reached (or has scrubbed back before) simply disappears
  // instead of leaving a tooltip behind.
  const tooltipPoint = useMemo(() => {
    if (!dotHover) return null
    const entry = revealed.find((item) => item.series.driver.number === dotHover.driver)
    const point = entry?.points.find((item) => item.lap === dotHover.lap)
    if (!entry || !point) return null
    return { series: entry.series, point }
  }, [dotHover, revealed])

  // With every car on screen, draw the faster lines last so they stay readable
  // through the midfield. A filtered graph keeps the legend order.
  const paths = filterActive ? revealed : [...revealed].reverse()

  // A chip for a driver hidden by the filter should not dim the lines that are
  // on screen, so only a visible driver can take the hover highlight.
  const focused =
    hovered !== null && (!filterActive || selected.has(hovered)) ? hovered : null

  const labelled = filterActive
    ? visible.length <= 8
      ? revealed
      : []
    : focused === null
      ? []
      : revealed.filter((entry) => entry.series.driver.number === focused)

  // Per-lap dots would clutter the full field, so they only appear for a small
  // filtered selection. The same condition gates the dot tooltip.
  const showDots = filterActive && visible.length <= 8

  // A backward scrub removes the point without a pointer move, so drop the
  // stored hover right away rather than leaving it to revive on the next pass.
  if (dotHover && (!showDots || !tooltipPoint)) {
    setDotHover(null)
  }

  const handleToggleDriver = (number: number) => {
    setDotHover(null)
    onToggleDriver(number)
  }

  const handleResetFilter = () => {
    setDotHover(null)
    onResetFilter()
  }

  const displayLap = currentLap ?? Math.min(totalLaps, Math.floor(playheadLap) + 1)
  const showPlayhead = playheadLap >= 0 && playheadLap <= totalLaps
  const hiddenDrivers = data.drivers.length - series.length

  if (series.length === 0) {
    return (
      <Empty message="Lap timing is not available for this session, so race pace cannot be drawn." />
    )
  }

  return (
    <figure className="replay__pace">
      <div className="replay__pace-bar">
        <div className="replay__pace-legend" role="group" aria-label="Drivers">
          {series.map((entry) => {
            const isSelected = selected.has(entry.driver.number)
            return (
              <button
                key={entry.driver.number}
                type="button"
                className="replay__pace-chip"
                aria-pressed={isSelected}
                title={`${entry.driver.name} · ${entry.driver.team}${
                  entry.best === 0 ? '' : ` · best ${formatLapTime(entry.best)}`
                }`}
                onClick={() => handleToggleDriver(entry.driver.number)}
                onMouseEnter={() => setHovered(entry.driver.number)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(entry.driver.number)}
                onBlur={() => setHovered(null)}
                style={{ '--driver-color': entry.driver.color } as CSSProperties}
              >
                <span className="replay__pace-swatch" aria-hidden="true" />
                {entry.driver.acronym}
                <span className="sr-only"> {entry.driver.name}</span>
              </button>
            )
          })}
        </div>
        {filterActive ? (
          <button type="button" className="replay__tower-reset" onClick={handleResetFilter}>
            Reset
            <span className="sr-only"> driver filter</span>
          </button>
        ) : null}
      </div>

      <div className="replay__pace-shell" ref={shellRef}>
        <svg
          className="replay__pace-chart"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={`Race pace through lap ${displayLap} for ${visible.length} of ${series.length} drivers. The x-axis is lap number and the y-axis is lap time in minutes and seconds; very slow laps are hidden.`}
        >
          <defs>
            <clipPath id="replay-pace-clip">
              <rect
                x={chart.margin.left}
                y={chart.margin.top}
                width={chart.plotWidth}
                height={chart.plotHeight}
              />
            </clipPath>
          </defs>

          <g className="replay__pace-grid" aria-hidden="true">
            {chart.yTicks.map((tick) => (
              <g key={`y-${tick}`}>
                <line
                  x1={chart.margin.left}
                  x2={chart.margin.left + chart.plotWidth}
                  y1={chart.y(tick)}
                  y2={chart.y(tick)}
                />
                <text
                  x={chart.margin.left - 8}
                  y={chart.y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {lapTick(tick, chart.yStep)}
                </text>
              </g>
            ))}
            {chart.xTicks.map((tick, index) => (
              <g key={`x-${tick}`}>
                <line
                  x1={chart.x(tick)}
                  x2={chart.x(tick)}
                  y1={chart.margin.top}
                  y2={chart.margin.top + chart.plotHeight}
                />
                <text
                  x={chart.x(tick)}
                  y={chart.margin.top + chart.plotHeight + 18}
                  textAnchor={
                    index === 0 ? 'start' : index === chart.xTicks.length - 1 ? 'end' : 'middle'
                  }
                >
                  {tick}
                </text>
              </g>
            ))}
          </g>

          <text className="replay__pace-axis-title" x={chart.margin.left} y={12}>
            Lap time (min:sec)
          </text>
          <text className="replay__pace-axis-title" x={chart.margin.left} y={chart.height - 4}>
            Lap
          </text>

          {revealed.length === 0 ? (
            <text
              className="replay__pace-waiting"
              x={chart.margin.left + chart.plotWidth / 2}
              y={chart.margin.top + chart.plotHeight / 2}
              textAnchor="middle"
            >
              Lines draw as laps complete
            </text>
          ) : null}

          <g clipPath="url(#replay-pace-clip)">
            <g className="replay__pace-lines">
              {paths.map(({ series: entry, path }) => (
                <path
                  key={entry.driver.number}
                  className="replay__pace-line"
                  d={path}
                  stroke={entry.driver.color}
                  data-muted={
                    focused !== null && focused !== entry.driver.number ? 'true' : undefined
                  }
                />
              ))}
            </g>

            {showPlayhead ? (
              <line
                className="replay__pace-playhead"
                x1={chart.x(playheadLap)}
                x2={chart.x(playheadLap)}
                y1={chart.margin.top}
                y2={chart.margin.top + chart.plotHeight}
              />
            ) : null}

            {showDots ? (
              <g aria-hidden="true">
                {revealed.map(({ series: entry, points }) =>
                  points.map((point) => {
                    const active =
                      dotHover?.driver === entry.driver.number && dotHover.lap === point.lap
                    const cx = chart.x(point.lap)
                    const cy = chart.y(point.time)
                    return (
                      <g key={`${entry.driver.number}-${point.lap}`}>
                        <circle
                          className="replay__pace-dot"
                          cx={cx}
                          cy={cy}
                          r={active ? 3.1 : 2.3}
                          fill={entry.driver.color}
                          data-active={active ? 'true' : undefined}
                        />
                        <circle
                          className="replay__pace-dot-hit"
                          cx={cx}
                          cy={cy}
                          r={9}
                          onMouseEnter={() =>
                            setDotHover({ driver: entry.driver.number, lap: point.lap })
                          }
                          onMouseLeave={() => setDotHover(null)}
                        />
                      </g>
                    )
                  }),
                )}
              </g>
            ) : null}
          </g>

          <g aria-hidden="true">
            {labelled.map(({ series: entry, points }) => {
              const last = points[points.length - 1]
              const px = chart.x(last.lap)
              const py = chart.y(last.time)
              if (py < chart.margin.top || py > chart.margin.top + chart.plotHeight) return null
              const atRightEdge = px > chart.width - 64
              return (
                <g key={`label-${entry.driver.number}`}>
                  <circle cx={px} cy={py} r={3.2} fill={entry.driver.color} />
                  <text
                    className="replay__pace-label"
                    x={px + (atRightEdge ? -7 : 7)}
                    y={Math.max(13, py - 7)}
                    textAnchor={atRightEdge ? 'end' : 'start'}
                  >
                    {entry.driver.acronym}
                  </text>
                </g>
              )
            })}
          </g>

          {showDots && tooltipPoint ? (
            <PaceDotTooltip
              series={tooltipPoint.series}
              point={tooltipPoint.point}
              chart={chart}
            />
          ) : null}
        </svg>
      </div>

      <figcaption className="replay__pace-caption">
        {filterActive ? `${visible.length} of ${series.length} drivers` : `${series.length} drivers`}{' '}
        · each point is a completed lap, drawn live with the replay · pit stops, safety cars and
        other very slow laps hidden
        {hiddenDrivers > 0
          ? ` · ${hiddenDrivers} driver${hiddenDrivers === 1 ? '' : 's'} without lap timing`
          : ''}
      </figcaption>
    </figure>
  )
}

interface PaceDotTooltipProps {
  series: PaceSeries
  point: PacePoint
  chart: Chart
}

/**
 * A hover card for one lap dot. It is drawn in the same SVG as the chart (so it
 * scales with the plot) but outside the clip group, and it flips to the other
 * side of the dot when there is not enough room left or above.
 */
function PaceDotTooltip({ series, point, chart }: PaceDotTooltipProps) {
  const header = `${series.driver.acronym} · Lap ${point.lap}`
  const value = formatLapTime(point.time)
  const width = Math.round(
    Math.max(96, Math.max(header.length * 5.9, value.length * 7.1) + 24),
  )
  const height = 42
  const gap = 10

  const dotX = chart.x(point.lap)
  const dotY = chart.y(point.time)
  const minX = chart.margin.left
  const maxX = chart.margin.left + chart.plotWidth
  const minY = chart.margin.top
  const maxY = chart.margin.top + chart.plotHeight

  let x = dotX + gap
  if (x + width > maxX) x = dotX - gap - width
  x = Math.min(Math.max(x, minX), Math.max(minX, maxX - width))

  let y = dotY - gap - height
  if (y < minY) y = dotY + gap
  y = Math.min(Math.max(y, minY), Math.max(minY, maxY - height))

  return (
    <g className="replay__pace-tooltip" aria-hidden="true">
      <rect
        className="replay__pace-tooltip-card"
        x={x}
        y={y}
        width={width}
        height={height}
        rx={7}
      />
      <rect
        x={x + 2}
        y={y + 7}
        width={3}
        height={height - 14}
        rx={1.5}
        fill={series.driver.color}
      />
      <text className="replay__pace-tooltip-title" x={x + 12} y={y + 16}>
        {header}
      </text>
      <text className="replay__pace-tooltip-value" x={x + 12} y={y + 31}>
        {value}
      </text>
    </g>
  )
}

interface Chart {
  width: number
  height: number
  margin: { top: number; right: number; bottom: number; left: number }
  plotWidth: number
  plotHeight: number
  x: (lap: number) => number
  y: (value: number) => number
  xTicks: number[]
  yTicks: number[]
  yStep: number
}

function buildChart(series: readonly PaceSeries[], totalLaps: number, width: number): Chart {
  const height = Math.round(
    Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, width * 0.46)),
  )
  const margin = { top: 24, right: 18, bottom: 48, left: 46 }
  const plotWidth = Math.max(1, width - margin.left - margin.right)
  const plotHeight = Math.max(1, height - margin.top - margin.bottom)

  const times = series.flatMap((entry) => entry.points.map((point) => point.time))
  // `racePace` has already removed pit/neutralised laps, so use the full range
  // of the remaining laps. Trimming percentiles here would hide the fastest
  // laps below the bottom of the plot instead of clipping only true outliers.
  const fastest = times.length > 0 ? Math.min(...times) : 0
  const slowest = times.length > 0 ? Math.max(...times) : 1
  const pad = Math.max(150, (slowest - fastest) * 0.12)
  const yMin = Math.max(0, fastest - pad)
  const yMax = slowest + pad
  const yStep = niceStep(yMax - yMin, 7)

  const x = (lap: number) => margin.left + (lap / totalLaps) * plotWidth
  const y = (value: number) =>
    margin.top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * plotHeight

  const yTicks: number[] = []
  for (let tick = Math.ceil(yMin / yStep) * yStep; tick <= yMax + 0.001; tick += yStep) {
    yTicks.push(tick)
  }

  const xTicks = lapTicks(totalLaps, plotWidth)

  return {
    width,
    height,
    margin,
    plotWidth,
    plotHeight,
    x,
    y,
    xTicks,
    yTicks,
    yStep,
  }
}

function lapTicks(totalLaps: number, plotWidth: number): number[] {
  const target = Math.max(4, Math.min(7, Math.round(plotWidth / 130)))
  const step = Math.max(1, Math.round(niceStep(totalLaps, target)))
  const ticks = new Set<number>([1])
  for (let lap = step; lap < totalLaps; lap += step) {
    if (totalLaps - lap < step / 2) break
    ticks.add(lap)
  }
  ticks.add(totalLaps)
  return [...ticks].sort((a, b) => a - b)
}

function pacePath(
  points: readonly PacePoint[],
  x: (lap: number) => number,
  y: (value: number) => number,
): string {
  return smoothPath(points.map((point) => ({ x: x(point.lap), y: y(point.time) })))
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target)
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)))
  const residual = raw / magnitude
  const step = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10
  return step * magnitude
}

/**
 * Axis labels as a lap clock. A tick step of a second or more stays whole;
 * smaller steps need a decimal to distinguish adjacent lines.
 */
function lapTick(value: number, step: number): string {
  const total = Math.max(0, Math.round(value))
  const minutes = Math.floor(total / 60_000)
  const seconds = (total % 60_000) / 1_000
  const decimals = step >= 1_000 ? 0 : step >= 100 ? 1 : 2
  const text = seconds.toFixed(decimals)
  if (minutes === 0) return text
  return `${minutes}:${text.padStart(decimals > 0 ? decimals + 3 : 2, '0')}`
}

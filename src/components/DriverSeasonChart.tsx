import { chartInk } from '../api/teams'
import { useMeasuredWidth } from '../hooks/useMeasuredWidth'
import type { DriverSeason, FinishOutcome } from '../lib/driverSeason'

export type StatsView = 'points' | 'positions'

interface DriverSeasonChartProps {
  season: DriverSeason
  view: StatsView
  /** Team colour from the standings table. */
  color: string
  driver: string
}

interface ChartDatum {
  index: number
  round: number
  value: number
  name: string
  outcome?: FinishOutcome
}

interface Chart {
  width: number
  height: number
  margin: { top: number; right: number; bottom: number; left: number }
  plotWidth: number
  plotHeight: number
  x: (index: number) => number
  y: (value: number) => number
  yTicks: number[]
  xTicks: Array<{ index: number; round: number }>
  path: string
  lastRound: number | null
}

const OUTCOME_LABELS: Record<FinishOutcome, string> = {
  finish: 'finished',
  retired: 'retired',
  dsq: 'disqualified',
  dns: 'did not start',
}

/**
 * One discrete event per slot: a straight polyline, never a smoothed curve,
 * because there is no value between two rounds. The two views share the axis
 * geometry; only the y direction and the marker semantics differ.
 */
export function DriverSeasonChart({ season, view, color, driver }: DriverSeasonChartProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  const series = chartData(season, view)
  const chart = buildChart(season, series, view, width)
  const stroke = chartInk(color)
  const lastRound = chart.lastRound

  if (series.length === 0) {
    return <p className="stats__chart-empty">No race classification for this driver yet.</p>
  }

  const ariaLabel =
    view === 'points'
      ? `${driver}: cumulative championship points after each event, through round ${lastRound}.`
      : `${driver}: race classification after each event, P1 at the top, through round ${lastRound}.`

  const summary = summaryText(driver, view, series)

  return (
    <figure className={`stats__chart stats__chart--${view}`}>
      <div className="stats__chart-shell" ref={ref}>
        <svg
          className="stats__chart-svg"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={ariaLabel}
        >
          <g className="stats__chart-grid" aria-hidden="true">
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
                  {tick}
                </text>
              </g>
            ))}
            {chart.xTicks.map((tick) => (
              <g key={`x-${tick.round}`}>
                <line
                  x1={chart.x(tick.index)}
                  x2={chart.x(tick.index)}
                  y1={chart.margin.top}
                  y2={chart.margin.top + chart.plotHeight}
                />
                <text
                  x={chart.x(tick.index)}
                  y={chart.margin.top + chart.plotHeight + 17}
                  textAnchor={xAnchor(tick.index, season.rounds.length)}
                >
                  {tick.round}
                </text>
              </g>
            ))}
          </g>

          <text className="stats__chart-axis" x={chart.margin.left} y={11}>
            {view === 'points' ? 'Pts' : 'Pos'}
          </text>
          <text
            className="stats__chart-axis"
            x={chart.margin.left + chart.plotWidth}
            y={chart.height - 3}
            textAnchor="end"
          >
            Round
          </text>

          {chart.path !== '' && (
            <path className="stats__chart-line" d={chart.path} stroke={stroke} />
          )}

          <g>
            {chart.points.map((point) => (
              <circle
                key={`${point.round}-${point.value}`}
                className={`stats__chart-dot stats__chart-dot--${markerKind(view, point.outcome)}`}
                cx={chart.x(point.index)}
                cy={chart.y(point.value)}
                r={view === 'points' ? 2.6 : 3}
                fill={view === 'points' || point.outcome === 'finish' ? stroke : 'var(--paper)'}
                stroke={
                  view === 'points' || point.outcome === 'finish'
                    ? undefined
                    : outcomeColor(point.outcome)
                }
              >
                <title>{tooltip(view, point)}</title>
              </circle>
            ))}
          </g>
        </svg>
      </div>

      <figcaption className="stats__chart-caption">
        {view === 'points'
          ? `Cumulative points · race + sprint · through round ${lastRound}`
          : `Race classification · P1 at the top · through round ${lastRound}`}
      </figcaption>

      {view === 'positions' && (
        <p className="stats__legend">
          <span className="stats__legend-item">
            <span className="stats__legend-dot stats__legend-dot--finish" aria-hidden="true" />
            finish
          </span>
          <span className="stats__legend-item">
            <span className="stats__legend-dot stats__legend-dot--retired" aria-hidden="true" />
            retirement
          </span>
          <span className="stats__legend-item">
            <span className="stats__legend-dot stats__legend-dot--dsq" aria-hidden="true" />
            DSQ / DNS
          </span>
        </p>
      )}

      <p className="sr-only">{summary}</p>
    </figure>
  )
}

function chartData(season: DriverSeason, view: StatsView): ChartDatum[] {
  const nameOf = (index: number, round: number) => season.rounds[index]?.name ?? `Round ${round}`

  if (view === 'points') {
    return season.points.map((point) => ({
      ...point,
      name: nameOf(point.index, point.round),
    }))
  }

  return season.positions.map((point) => ({
    ...point,
    name: nameOf(point.index, point.round),
  }))
}

function buildChart(
  season: DriverSeason,
  series: readonly ChartDatum[],
  view: StatsView,
  width: number,
): Chart & { points: ChartDatum[] } {
  const height = width < 520 ? 220 : 280
  const margin = { top: 20, right: 16, bottom: 36, left: 44 }
  const plotWidth = Math.max(1, width - margin.left - margin.right)
  const plotHeight = Math.max(1, height - margin.top - margin.bottom)
  const total = Math.max(1, season.rounds.length)

  const x = (index: number) =>
    total <= 1 ? margin.left + plotWidth / 2 : margin.left + (index / (total - 1)) * plotWidth

  let yMin = 0
  let yMax = 1
  if (view === 'points') {
    const max = Math.max(0, ...series.map((point) => point.value))
    yMax = niceMax(max)
  } else {
    yMin = 1
    yMax = Math.max(2, ...series.map((point) => point.value))
  }

  const y =
    view === 'points'
      ? (value: number) => margin.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight
      : (value: number) => margin.top + ((value - yMin) / (yMax - yMin)) * plotHeight

  const yTicks = view === 'points' ? pointsTicks(yMax) : positionTicks(yMax)

  const slot = plotWidth / Math.max(1, total - 1)
  const labelStep = Math.max(1, Math.ceil(44 / Math.max(1, slot)))
  const xTicks: Array<{ index: number; round: number }> = []
  for (let index = 0; index < season.rounds.length; index += labelStep) {
    xTicks.push({ index, round: season.rounds[index].round })
  }

  let path = ''
  series.forEach((point, index) => {
    path += `${index === 0 ? 'M' : 'L'} ${x(point.index).toFixed(1)} ${y(point.value).toFixed(1)} `
  })

  const last = series[series.length - 1]

  return {
    points: [...series],
    width,
    height,
    margin,
    plotWidth,
    plotHeight,
    x,
    y,
    yTicks,
    xTicks,
    path: path.trim(),
    lastRound: last?.round ?? null,
  }
}

function pointsTicks(yMax: number): number[] {
  const step = Math.max(1, niceStep(yMax, 5))
  const ticks: number[] = []
  for (let tick = 0; tick <= yMax + 0.001; tick += step) ticks.push(tick)
  return ticks
}

function positionTicks(yMax: number): number[] {
  if (yMax <= 5) {
    return Array.from({ length: yMax }, (_, index) => index + 1)
  }
  const ticks = [1, 5, 10, 15, 20].filter((tick) => tick <= yMax)
  if (yMax - ticks[ticks.length - 1] >= 3) ticks.push(yMax)
  return ticks
}

/** A round multiple just above the season's best total, so ticks land on round numbers. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const step = Math.max(1, niceStep(value, 5))
  return Math.ceil(value / step) * step
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target)
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)))
  const residual = raw / magnitude
  const step = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10
  return step * magnitude
}

function xAnchor(index: number, total: number): 'start' | 'middle' | 'end' {
  if (total <= 1) return 'middle'
  if (index === 0) return 'start'
  if (index === total - 1) return 'end'
  return 'middle'
}

function markerKind(view: StatsView, outcome: FinishOutcome | undefined): string {
  if (view === 'points') return 'series'
  return outcome ?? 'finish'
}

function outcomeColor(outcome: FinishOutcome | undefined): string {
  if (outcome === 'retired') return 'var(--red)'
  if (outcome === 'dsq') return 'var(--amber)'
  return 'var(--line-strong)'
}

function tooltip(view: StatsView, point: ChartDatum): string {
  const prefix = `R${point.round} · ${point.name}`
  if (view === 'points') return `${prefix} · ${point.value} pts`
  if (point.outcome === undefined || point.outcome === 'finish') {
    return `${prefix} · P${point.value}`
  }
  return `${prefix} · P${point.value} · ${OUTCOME_LABELS[point.outcome]}`
}

function summaryText(driver: string, view: StatsView, series: readonly ChartDatum[]): string {
  const first = series[0]
  const last = series[series.length - 1]

  if (view === 'points') {
    return `${driver} had ${first.value} points after round ${first.round} and ${last.value} after round ${last.round}.`
  }

  let best = Infinity
  let worst = 0
  for (const point of series) {
    best = Math.min(best, point.value)
    worst = Math.max(worst, point.value)
  }
  return `${driver}'s race classifications run from P${best} to P${worst} across ${series.length} events.`
}

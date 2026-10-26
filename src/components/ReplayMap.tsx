import { useMemo } from 'react'
import { readableInk } from '../api/teams'
import { prepareCircuit } from '../lib/circuit'
import { interpolatePosition, trackStatusAt, weatherAt } from '../lib/replay'
import type { ReplayData, ReplayTrackStatus as ReplayTrackStatusState } from '../lib/replay'
import { ReplayTrackStatus } from './ReplayTrackStatus'
import { ReplayWeather } from './ReplayWeather'

interface ReplayMapProps {
  data: ReplayData
  current: number
  /** Empty means every car; otherwise only these driver numbers are drawn. */
  selected: ReadonlySet<number>
}

/**
 * The circuit outline and every car in its team colour. SVG is enough for a
 * couple of dozen dots and keeps the shapes crisp at any dialog width.
 */
export function ReplayMap({ data, current, selected }: ReplayMapProps) {
  const transform = useMemo(() => prepareCircuit(data.circuit), [data.circuit])

  const cars = useMemo(() => {
    const drivers =
      selected.size === 0
        ? data.drivers
        : data.drivers.filter((driver) => selected.has(driver.number))

    return drivers
      .map((driver) => {
        const point = interpolatePosition(driver, current)
        if (!point) return null
        const [sx, sy] = transform.project(point.x, point.y)
        return { driver, sx, sy }
      })
      .filter((car): car is NonNullable<typeof car> => car !== null)
      // Paint slower cars first so a leader's marker sits on top in a pack.
      .sort((a, b) => b.driver.number - a.driver.number)
  }, [data.drivers, current, transform, selected])

  const carLabel = cars.length === 1 ? 'car' : 'cars'
  const weather = weatherAt(data.weather, current)
  const status = trackStatusAt(data.safetyCars, data.flags, current)

  return (
    <figure className="replay__figure">
      <div className="replay__map-shell">
        <ReplayWeather weather={weather} />
        <div className="replay__stage" data-track-status={status?.kind}>
          <ReplayTrackStatus status={status} />
          <svg
            className="replay__map"
            viewBox={transform.viewBox}
            role="img"
            aria-label={`${data.title} replay with ${cars.length} ${carLabel} on track${statusLabel(status)}`}
          >
            {transform.outlinePath && (
              <path className="replay__outline" d={transform.outlinePath} />
            )}

            {cars.map(({ driver, sx, sy }) => (
              <g key={driver.number} className="replay__car" transform={`translate(${sx} ${sy})`}>
                <circle
                  className="replay__car-dot"
                  r={15}
                  fill={driver.color}
                  stroke={readableInk(driver.color)}
                  strokeWidth={2}
                />
                <text
                  className="replay__car-code"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={readableInk(driver.color)}
                >
                  {driver.acronym}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
      <figcaption className="replay__map-caption">
        {cars.length} of {data.drivers.length} cars on track
        {data.circuit.approximate ? ' · outline traced from cars' : ''}
      </figcaption>
    </figure>
  )
}

function statusLabel(status: ReplayTrackStatusState | null): string {
  if (!status) return ''

  if (status.kind === 'RED') return ', red flag, race suspended'
  if (status.kind === 'SC') return ', safety car'
  if (status.kind === 'VSC') return ', virtual safety car'

  const sectors =
    status.sectors.length > 0 ? ` in sectors ${status.sectors.join(', ')}` : ''
  return status.kind === 'DOUBLE YELLOW'
    ? `, double yellow flag${sectors}`
    : `, yellow flag${sectors}`
}

import { useMemo } from 'react'
import { readableInk } from '../api/teams'
import { prepareCircuit } from '../lib/circuit'
import { interpolatePosition } from '../lib/replay'
import type { ReplayData } from '../lib/replay'

interface ReplayMapProps {
  data: ReplayData
  current: number
}

/**
 * The circuit outline and every car in its team colour. SVG is enough for a
 * couple of dozen dots and keeps the shapes crisp at any dialog width.
 */
export function ReplayMap({ data, current }: ReplayMapProps) {
  const transform = useMemo(() => prepareCircuit(data.circuit), [data.circuit])

  const cars = useMemo(
    () =>
      data.drivers
        .map((driver) => {
          const point = interpolatePosition(driver, current)
          if (!point) return null
          const [sx, sy] = transform.project(point.x, point.y)
          return { driver, sx, sy }
        })
        .filter((car): car is NonNullable<typeof car> => car !== null)
        // Paint slower cars first so a leader's marker sits on top in a pack.
        .sort((a, b) => b.driver.number - a.driver.number),
    [data.drivers, current, transform],
  )

  return (
    <figure className="replay__figure">
      <svg
        className="replay__map"
        viewBox={transform.viewBox}
        role="img"
        aria-label={`${data.title} replay with ${cars.length} cars on track`}
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
      <figcaption className="replay__map-caption">
        {cars.length} of {data.drivers.length} cars on track
        {data.circuit.approximate ? ' · outline traced from cars' : ''}
      </figcaption>
    </figure>
  )
}

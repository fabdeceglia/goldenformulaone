import { useMemo } from 'react'
import { readableInk } from '../api/teams'
import { prepareCircuit } from '../lib/circuit'
import { lapProgressAt, locationAt } from '../lib/battle'
import type { QualifyingBattle } from '../lib/battle'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface BattleTrackProps {
  battle: QualifyingBattle
  current: number
}

/**
 * The battle map is shorter than the race replay's so the cockpits fit. On a
 * short laptop screen the extra height is what pushes the transport below the
 * fold, so the circuit gets a wider frame there and the whole battle stays on
 * one screen.
 */
const BATTLE_MAP_HEIGHT = 430
const BATTLE_MAP_HEIGHT_SHORT = 355

/**
 * Both laps share one circuit frame, so their coordinates can be plotted
 * directly. The cars are ghost markers: `location` has no lateral placement, so
 * they sit on the same driven line. The two progress rows underneath carry the
 * separation that the dots cannot show when they overlap.
 */
export function BattleTrack({ battle, current }: BattleTrackProps) {
  const shortViewport = useMediaQuery('(min-width: 721px) and (max-height: 880px)')
  const mapHeight = shortViewport ? BATTLE_MAP_HEIGHT_SHORT : BATTLE_MAP_HEIGHT
  const transform = useMemo(
    () => prepareCircuit(battle.circuit, mapHeight),
    [battle.circuit, mapHeight],
  )

  const sides = [
    { key: 'a', side: battle.a },
    { key: 'b', side: battle.b },
  ] as const

  const cars = sides
    .map(({ key, side }) => {
      const point = locationAt(side.lap, current)
      if (!point) return null
      const [sx, sy] = transform.project(point.x, point.y)
      return {
        key,
        side,
        sx,
        sy,
        finished: current >= side.lap.duration,
      }
    })
    .filter((car): car is NonNullable<typeof car> => car !== null)

  return (
    <figure className="battle__figure replay__figure">
      <div className="replay__map-shell">
        <svg
          className="battle__map replay__map"
          viewBox={transform.viewBox}
          role="img"
          aria-label={`Circuit map with ${battle.a.driver.acronym} and ${battle.b.driver.acronym}`}
        >
          {transform.outlinePath && (
            <path className="replay__outline" d={transform.outlinePath} />
          )}

          {cars.map((car) => (
            <g
              key={car.key}
              className="replay__car"
              data-finished={car.finished || undefined}
              transform={`translate(${car.sx} ${car.sy})`}
            >
              <circle
                className="replay__car-dot"
                r={15}
                fill={car.side.driver.color}
                stroke={readableInk(car.side.driver.color)}
                strokeWidth={2}
              />
              <text
                className="replay__car-code"
                textAnchor="middle"
                dominantBaseline="central"
                fill={readableInk(car.side.driver.color)}
              >
                {car.side.driver.acronym}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="battle__ribbons">
        {sides.map(({ key, side }) => {
          const progress = lapProgressAt(side.lap, current) * 100
          return (
            <div className="battle__ribbon-row" key={key}>
              <span className="battle__ribbon-code" style={{ color: side.driver.color }}>
                {side.driver.acronym}
              </span>
              <div className="battle__ribbon" aria-hidden="true">
                <span
                  className="battle__ribbon-marker"
                  style={{ left: `${progress}%`, background: side.driver.color }}
                />
              </div>
              <span className="battle__ribbon-pct">{Math.round(progress)}%</span>
            </div>
          )
        })}
      </div>

      <figcaption className="replay__map-caption battle__caption">
        Ghost view · lap progress from integrated speed
        {battle.circuit.approximate ? ' · outline traced from the driven lap' : ''}
      </figcaption>
    </figure>
  )
}

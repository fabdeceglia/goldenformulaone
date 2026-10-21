import { useMemo } from 'react'
import {
  driverTimingAt,
  formatInterval,
  formatLapTime,
  gapAt,
  lapAt,
  standingsAt,
  tyreLabel,
} from '../lib/replay'
import type { ReplayData } from '../lib/replay'
import { Position } from './Position'

interface ReplayLeaderboardProps {
  data: ReplayData
  current: number
}

/**
 * The live standings tower. It is derived entirely from the position feed, so
 * it reorders exactly when the timing data does.
 */
export function ReplayLeaderboard({ data, current }: ReplayLeaderboardProps) {
  const standings = useMemo(() => standingsAt(data, current), [data, current])
  const lap = lapAt(data.laps, current)

  if (standings.length === 0) {
    return (
      <section className="replay__tower-wrap" aria-label="Standings">
        <div className="replay__tower-head">
          <h3 className="replay__tower-title">Standings</h3>
          {lap !== null && data.laps?.total ? (
            <span className="replay__tower-lap-count" aria-label={`Lap ${lap} of ${data.laps.total}`}>
              Lap {lap} / {data.laps.total}
            </span>
          ) : null}
        </div>
        <p className="replay__tower-empty">Position data is not available for this session.</p>
      </section>
    )
  }

  return (
    <section className="replay__tower-wrap" aria-label="Standings">
      <div className="replay__tower-head">
        <h3 className="replay__tower-title">Standings</h3>
        {lap !== null && data.laps?.total ? (
          <span className="replay__tower-lap-count" aria-label={`Lap ${lap} of ${data.laps.total}`}>
            Lap {lap} / {data.laps.total}
          </span>
        ) : null}
      </div>
      <ol className="replay__tower">
        {standings.map(({ position, driver }) => {
          const timing = driverTimingAt(driver, current)
          const compound = timing.compound
          const gap = position > 1 ? gapAt(driver, current) : null

          return (
            <li
              key={driver.number}
              className="replay__tower-row"
              title={`${driver.name} · ${driver.team}`}
            >
              <Position value={String(position)} color={driver.color} />
              <span className="replay__tower-code">{driver.acronym}</span>
              <span
                className="replay__tower-gap"
                aria-label={
                  position === 1
                    ? 'Leader'
                    : gap === null
                      ? 'Gap to car ahead unavailable'
                      : `Gap to car ahead ${formatInterval(gap)}`
                }
              >
                {gap === null ? '—' : formatInterval(gap)}
              </span>
              <span className="replay__tower-lap">
                {timing.lapTime === null ? '—' : formatLapTime(timing.lapTime)}
              </span>
              <span
                className="replay__tower-tyre"
                data-compound={compound ?? '?'}
                title={compound ? `${tyreLabel(compound)} tyre` : 'Tyre data unavailable'}
              >
                {compound ? (
                  <>
                    <span aria-hidden="true">{compound}</span>
                    <span className="sr-only">{tyreLabel(compound)} tyre</span>
                  </>
                ) : (
                  <span aria-hidden="true">–</span>
                )}
              </span>
              <span className="sr-only">
                {driver.name}, {driver.team}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

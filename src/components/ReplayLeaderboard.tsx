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
  /** Empty means no filter; otherwise highlights these driver numbers. */
  selected: ReadonlySet<number>
  onToggleDriver: (number: number) => void
  onResetFilter: () => void
}

/**
 * The live standings tower. It is derived entirely from the position feed, so
 * it reorders exactly when the timing data does. Every row is a toggle button:
 * the tower always lists the full field, while the map narrows to the selection.
 */
export function ReplayLeaderboard({
  data,
  current,
  selected,
  onToggleDriver,
  onResetFilter,
}: ReplayLeaderboardProps) {
  const standings = useMemo(() => standingsAt(data, current), [data, current])
  const lap = lapAt(data.laps, current)
  const filterActive = selected.size > 0

  const header = (
    <div className="replay__tower-head">
      <h3 className="replay__tower-title">Standings</h3>
      <div className="replay__tower-meta">
        {filterActive ? (
          <button type="button" className="replay__tower-reset" onClick={onResetFilter}>
            Reset
            <span className="sr-only"> track filter</span>
          </button>
        ) : null}
        {lap !== null && data.laps?.total ? (
          <span className="replay__tower-lap-count" aria-label={`Lap ${lap} of ${data.laps.total}`}>
            Lap {lap} / {data.laps.total}
          </span>
        ) : null}
      </div>
    </div>
  )

  if (standings.length === 0) {
    return (
      <section className="replay__tower-wrap" aria-label="Standings">
        {header}
        <p className="replay__tower-empty">Position data is not available for this session.</p>
      </section>
    )
  }

  return (
    <section className="replay__tower-wrap" aria-label="Standings">
      {header}
      <ol className="replay__tower">
        {standings.map(({ position, driver }) => {
          const timing = driverTimingAt(driver, current)
          const compound = timing.compound
          const pitStops = timing.pitStops
          const gap = position > 1 ? gapAt(driver, current) : null
          const isSelected = selected.has(driver.number)

          return (
            <li key={driver.number} className="replay__tower-item">
              <button
                type="button"
                className="replay__tower-row"
                aria-pressed={isSelected}
                onClick={() => onToggleDriver(driver.number)}
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
                  className="replay__tower-tyre-cell"
                  title={`${compound ? `${tyreLabel(compound)} tyre` : 'Tyre data unavailable'}${
                    pitStops === null
                      ? ''
                      : ` · ${pitStops} pit stop${pitStops === 1 ? '' : 's'}`
                  }`}
                >
                  <span className="replay__tower-tyre" data-compound={compound ?? '?'}>
                    {compound ? (
                      <>
                        <span aria-hidden="true">{compound}</span>
                        <span className="sr-only">{tyreLabel(compound)} tyre</span>
                      </>
                    ) : (
                      <span aria-hidden="true">–</span>
                    )}
                  </span>
                  {pitStops !== null ? (
                    <>
                      <span className="replay__tower-stops" aria-hidden="true">
                        <svg
                          className="replay__tower-stops-icon"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                        <span>{pitStops}</span>
                      </span>
                      <span className="sr-only">
                        {pitStops} pit stop{pitStops === 1 ? '' : 's'}
                      </span>
                    </>
                  ) : null}
                </span>
                <span className="sr-only">
                  {driver.name}, {driver.team}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

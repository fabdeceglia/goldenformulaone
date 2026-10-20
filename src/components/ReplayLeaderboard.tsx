import { useMemo } from 'react'
import { standingsAt } from '../lib/replay'
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

  if (standings.length === 0) {
    return (
      <section className="replay__tower-wrap" aria-label="Standings">
        <h3 className="replay__tower-title">Standings</h3>
        <p className="replay__tower-empty">Position data is not available for this session.</p>
      </section>
    )
  }

  return (
    <section className="replay__tower-wrap" aria-label="Standings">
      <h3 className="replay__tower-title">Standings</h3>
      <ol className="replay__tower">
        {standings.map(({ position, driver }) => (
          <li key={driver.number} className="replay__tower-row">
            <Position value={String(position)} color={driver.color} />
            <span className="replay__tower-code">{driver.acronym}</span>
            <span className="replay__tower-name">{driver.name}</span>
            <span className="replay__tower-team">{driver.team}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

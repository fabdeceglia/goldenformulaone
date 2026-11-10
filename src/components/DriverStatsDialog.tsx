import { useState } from 'react'
import { fetchDriverSeason } from '../api/driverSeason'
import type { DriverStanding } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { driverName } from '../lib/format'
import { SeasonChart } from './SeasonChart'
import type { StatsView } from './SeasonChart'
import { SeasonStatsAside } from './SeasonStatsAside'
import { SeasonStatsNav } from './SeasonStatsNav'
import { Empty, ErrorState, Loading } from './Feedback'
import { Modal } from './Modal'
import { Tabs } from './Tabs'

interface DriverStatsDialogProps {
  season: string
  standing: DriverStanding
  /** One-based position in the standings list. */
  position: number
  total: number
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

const STATS_TABS = [
  { id: 'points', label: 'Points' },
  { id: 'positions', label: 'Finish position' },
] as const satisfies ReadonlyArray<{ id: StatsView; label: string }>

/**
 * A driver's season as two charts plus a small stat list. The dialog receives
 * the whole standings row so the header can show the table's current position
 * and total without a second fetch.
 */
export function DriverStatsDialog({
  season,
  standing,
  position,
  total,
  onPrevious,
  onNext,
  onClose,
}: DriverStatsDialogProps) {
  const [view, setView] = useState<StatsView>('points')
  const driverId = standing.Driver.driverId
  const driver = driverName(standing.Driver)
  const team = standing.Constructors[0]?.name ?? '—'
  const meta = `${team} · P${standing.position} · ${standing.points} pts`

  const { data, loading, error, reload } = useFetch(
    (signal) => fetchDriverSeason(season, driverId, signal),
    [season, driverId],
  )

  const stats = data?.stats ?? null

  return (
    <Modal label={`${driver} season statistics`} size="wide" onClose={onClose}>
      <div className="stats">
        <header className="stats__head">
          <div className="stats__head-text">
            <h2 className="stats__name">{driver}</h2>
            <p className="stats__meta">{meta}</p>
          </div>
          <SeasonStatsNav
            position={position}
            total={total}
            noun="driver"
            onPrevious={onPrevious}
            onNext={onNext}
          />
        </header>

        <div className="stats__viewbar">
          <Tabs
            tabs={STATS_TABS}
            active={view}
            onChange={setView}
            ariaLabel="Season chart"
            variant="compact"
          />
        </div>

        <div className="stats__body">
          <div
            className="stats__plot"
            role="tabpanel"
            id={`panel-${view}`}
            aria-labelledby={`tab-${view}`}
          >
            {loading && !data ? (
              <Loading message="Loading season statistics…" />
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : !data || data.rounds.length === 0 ? (
              <Empty message="No race data for this driver yet." />
            ) : (
              <SeasonChart season={data} view={view} subject={driver} />
            )}
          </div>

          <SeasonStatsAside stats={stats} />
        </div>
      </div>
    </Modal>
  )
}

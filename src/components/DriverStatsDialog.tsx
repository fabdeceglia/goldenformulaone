import { useState } from 'react'
import { fetchDriverSeason } from '../api/driverSeason'
import { teamColor } from '../api/teams'
import type { DriverStanding } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import type { DriverStats } from '../lib/driverSeason'
import { driverName } from '../lib/format'
import { DriverSeasonChart } from './DriverSeasonChart'
import type { StatsView } from './DriverSeasonChart'
import { Empty, ErrorState, Loading } from './Feedback'
import { Modal } from './Modal'
import { Tabs } from './Tabs'

interface DriverStatsDialogProps {
  season: string
  standing: DriverStanding
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
export function DriverStatsDialog({ season, standing, onClose }: DriverStatsDialogProps) {
  const [view, setView] = useState<StatsView>('points')
  const driverId = standing.Driver.driverId
  const driver = driverName(standing.Driver)

  const { data, loading, error, reload } = useFetch(
    (signal) => fetchDriverSeason(season, driverId, signal),
    [season, driverId],
  )

  const stats = data?.stats ?? null

  return (
    <Modal label={`${driver} season statistics`} size="wide" onClose={onClose}>
      <div className="stats">
        <header className="stats__head">
          <h2 className="stats__name">{driver}</h2>
          <p className="stats__meta">
            {standing.Constructors[0]?.name ?? '—'} · P{standing.position} · {standing.points} pts
          </p>
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
              <DriverSeasonChart
                season={data}
                view={view}
                color={teamColor(standing.Constructors[0]?.constructorId)}
                driver={driver}
              />
            )}
          </div>

          <aside className="stats__aside" aria-label="Season statistics">
            <dl className="stats__list">
              <Stat label="Victories" value={statValue(stats, (stats) => stats.wins)} />
              <Stat label="Retirements" value={statValue(stats, (stats) => stats.retirements)} />
              <Stat
                label="Avg finish"
                value={average(stats, (stats) => stats.avgRace)}
                hint={
                  stats && stats.raceSample > 0
                    ? `${stats.raceSample} classified`
                    : 'no classified races'
                }
              />
              <Stat
                label="Avg qualifying"
                value={average(stats, (stats) => stats.avgQualifying)}
                hint={
                  stats && stats.qualifyingSample > 0
                    ? `${stats.qualifyingSample} sessions`
                    : undefined
                }
              />
            </dl>

            {stats && (stats.dns > 0 || stats.dsq > 0) && (
              <p className="stats__note">
                {[
                  stats.dns > 0 ? `${stats.dns} DNS` : null,
                  stats.dsq > 0 ? `${stats.dsq} DSQ` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                not counted in averages
              </p>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stats__stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="stats__sample">{hint}</span>}
      </dd>
    </div>
  )
}

function statValue(stats: DriverStats | null, pick: (stats: DriverStats) => number): string {
  return stats ? String(pick(stats)) : '—'
}

function average(stats: DriverStats | null, pick: (stats: DriverStats) => number | null): string {
  const value = stats ? pick(stats) : null
  return value === null ? '—' : value.toFixed(1)
}

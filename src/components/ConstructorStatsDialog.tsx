import { fetchConstructorSeason } from '../api/constructorSeason'
import type { ConstructorStanding } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { Empty, ErrorState, Loading } from './Feedback'
import { Modal } from './Modal'
import { SeasonChart } from './SeasonChart'
import { SeasonStatsAside } from './SeasonStatsAside'

interface ConstructorStatsDialogProps {
  season: string
  standing: ConstructorStanding
  onClose: () => void
}

/**
 * A constructor's cumulative points chart plus the team's aggregate stats. Only
 * the points view exists here: a team has two classifications per round, so a
 * single finish-position line would have to pick one car over the other.
 */
export function ConstructorStatsDialog({ season, standing, onClose }: ConstructorStatsDialogProps) {
  const team = standing.Constructor.name
  const constructorId = standing.Constructor.constructorId

  const { data, loading, error, reload } = useFetch(
    (signal) => fetchConstructorSeason(season, constructorId, signal),
    [season, constructorId],
  )

  const stats = data?.stats ?? null

  return (
    <Modal label={`${team} season statistics`} size="wide" onClose={onClose}>
      <div className="stats">
        <header className="stats__head">
          <h2 className="stats__name">{team}</h2>
          <p className="stats__meta">
            {season} season · P{standing.position} · {standing.points} pts
          </p>
        </header>

        <div className="stats__body">
          <div className="stats__plot">
            {loading && !data ? (
              <Loading message="Loading season statistics…" />
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : !data || data.rounds.length === 0 ? (
              <Empty message="No race data for this team yet." />
            ) : (
              <SeasonChart season={data} view="points" subject={team} />
            )}
          </div>

          <SeasonStatsAside stats={stats} qualifyingUnit="entries" />
        </div>
      </div>
    </Modal>
  )
}

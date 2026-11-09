import { useState } from 'react'
import { api } from '../api/client'
import type { ConstructorStanding as Standing } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { ConstructorStatsDialog } from './ConstructorStatsDialog'
import { Empty, ErrorState, Loading } from './Feedback'
import { Position } from './Position'
import { SeasonChartIcon } from './SeasonChartIcon'

interface ConstructorStandingsProps {
  season: string
}

export function ConstructorStandings({ season }: ConstructorStandingsProps) {
  const [statsTeam, setStatsTeam] = useState<Standing | null>(null)
  const { data, loading, error, reload } = useFetch(
    (signal) => api.constructorStandings(season, signal),
    [season],
  )

  if (loading && !data) return <Loading message="Loading constructor standings…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const list = data?.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? []
  const round = data?.MRData.StandingsTable.StandingsLists[0]?.round

  if (list.length === 0) {
    return <Empty message={`No constructor standings are available for ${season} yet.`} />
  }

  return (
    <section className="panel" aria-labelledby="constructors-title">
      <div className="panel__head">
        <h2 className="panel__title" id="constructors-title">
          {season} Constructor Standings
        </h2>
        {round && <span className="panel__meta">After round {round}</span>}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="table__pos">
                Pos
              </th>
              <th scope="col">Team</th>
              <th scope="col" className="table__num">
                Wins
              </th>
              <th scope="col" className="table__num">
                Points
              </th>
              <th scope="col" className="table__icon">
                <span className="sr-only">Season statistics</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((standing) => (
              <tr key={standing.Constructor.constructorId}>
                <td className="table__pos">
                  <Position
                    value={standing.position}
                    positionText={standing.positionText}
                    constructorId={standing.Constructor.constructorId}
                  />
                </td>
                <td>
                  <div className="driver">
                    <span className="driver__name">{standing.Constructor.name}</span>
                  </div>
                </td>
                <td className="table__num">{standing.wins}</td>
                <td className="table__num table__num--strong">{standing.points}</td>
                <td className="table__icon">
                  <button
                    type="button"
                    className="table__icon-button"
                    aria-label={`Season statistics for ${standing.Constructor.name}`}
                    onClick={() => setStatsTeam(standing)}
                  >
                    <SeasonChartIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statsTeam && (
        <ConstructorStatsDialog
          season={season}
          standing={statsTeam}
          onClose={() => setStatsTeam(null)}
        />
      )}
    </section>
  )
}

import { api } from '../api/client'
import { useFetch } from '../hooks/useFetch'
import { Empty, ErrorState, Loading } from './Feedback'
import { Position } from './Position'

interface ConstructorStandingsProps {
  season: string
}

export function ConstructorStandings({ season }: ConstructorStandingsProps) {
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
        <h2 className="panel__title" id="constructors-title">{season} Constructor Standings</h2>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

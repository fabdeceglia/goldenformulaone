import { api } from '../api/client'
import type { Constructor } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { driverName } from '../lib/format'
import { Empty, ErrorState, Loading } from './Feedback'
import { Position, TeamBar } from './TeamBar'

interface DriverStandingsProps {
  season: string
}

export function DriverStandings({ season }: DriverStandingsProps) {
  const { data, loading, error, reload } = useFetch(
    (signal) => api.driverStandings(season, signal),
    [season],
  )

  if (loading && !data) return <Loading message="Loading driver standings…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const list = data?.MRData.StandingsTable.StandingsLists[0]?.DriverStandings ?? []
  const round = data?.MRData.StandingsTable.StandingsLists[0]?.round

  if (list.length === 0) {
    return <Empty message={`No driver standings are available for ${season} yet.`} />
  }

  return (
    <section className="panel" aria-labelledby="drivers-title">
      <div className="panel__head">
        <h2 className="panel__title" id="drivers-title">{season} Driver Standings</h2>
        {round && <span className="panel__meta">After round {round}</span>}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="table__pos">
                Pos
              </th>
              <th scope="col">Driver</th>
              <th scope="col" className="hide-sm">
                Team
              </th>
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
              <tr key={standing.Driver.driverId}>
                <td className="table__pos">
                  <Position value={standing.position} positionText={standing.positionText} />
                </td>
                <td>
                  <div className="driver">
                    <TeamBar constructorId={standing.Constructors[0]?.constructorId} />
                    <span className="driver__name">{driverName(standing.Driver)}</span>
                    {standing.Driver.code && (
                      <span className="driver__code">{standing.Driver.code}</span>
                    )}
                  </div>
                </td>
                <td className="muted hide-sm">{teamNames(standing.Constructors)}</td>
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

function teamNames(constructors: Constructor[]): string {
  if (constructors.length === 0) return '—'
  return constructors.map((constructor) => constructor.name).join(', ')
}

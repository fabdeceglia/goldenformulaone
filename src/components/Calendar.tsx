import type { Race } from '../api/types'
import { formatDate, formatDateTime } from '../lib/format'
import { Empty } from './Feedback'

interface CalendarProps {
  season: string
  races: Race[]
  /** Round of the featured event, highlighted in the list. */
  featuredRound: string | null
  onSelectRace: (round: string) => void
}

export function Calendar({ season, races, featuredRound, onSelectRace }: CalendarProps) {
  if (races.length === 0) {
    return <Empty message={`No races found for the ${season} season.`} />
  }

  return (
    <section className="panel" aria-labelledby="calendar-title">
      <div className="panel__head">
        <h2 className="panel__title" id="calendar-title">
          {season} Calendar
        </h2>
        <span className="panel__meta">{races.length} rounds</span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="table__round">
                Rnd
              </th>
              <th scope="col">Grand Prix</th>
              <th scope="col" className="hide-sm">
                Circuit
              </th>
              <th scope="col">Date</th>
              <th scope="col" className="table__action">
                <span className="sr-only">Results</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {races.map((race) => {
              const isFeatured = featuredRound === race.round
              return (
                <tr
                  key={race.round}
                  className={isFeatured ? 'is-featured' : undefined}
                  aria-current={isFeatured ? 'true' : undefined}
                >
                  <td className="table__round">{race.round}</td>
                  <td>
                    <span className="race-name">{race.raceName}</span>
                    <span className="race-country">{race.Circuit.Location.country}</span>
                  </td>
                  <td className="muted hide-sm">
                    <span className="race-circuit">{race.Circuit.circuitName}</span>
                    <span className="race-locality">{race.Circuit.Location.locality}</span>
                  </td>
                  <td title={formatDateTime(race.date, race.time)}>{formatDate(race.date)}</td>
                  <td className="table__action">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onSelectRace(race.round)}
                    >
                      Results
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

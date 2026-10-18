import { useState } from 'react'
import type { Race } from '../api/types'
import { formatDate, formatDateTime } from '../lib/format'
import { TODAY, eventFor, eventWindow } from '../lib/schedule'
import { CircuitInfoPanel } from './CircuitInfo'
import { Empty } from './Feedback'
import { FeaturedEventPanel } from './FeaturedEvent'
import { Modal } from './Modal'

interface CalendarProps {
  season: string
  races: Race[]
  /** Round of the featured event, highlighted in the list. */
  featuredRound: string | null
  onSelectRace: (round: string) => void
}

export function Calendar({ season, races, featuredRound, onSelectRace }: CalendarProps) {
  // A future round has no results to open, so it shows the weekend instead.
  const [detailsRound, setDetailsRound] = useState<string | null>(null)
  const detailsRace = detailsRound
    ? races.find((race) => race.round === detailsRound)
    : undefined

  // The circuit info popup is available for every round, past or future.
  const [infoRound, setInfoRound] = useState<string | null>(null)
  const infoRace = infoRound ? races.find((race) => race.round === infoRound) : undefined

  if (races.length === 0) {
    return <Empty message={`No races found for the ${season} season.`} />
  }

  return (
    <>
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
                  <span className="sr-only">Row actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {races.map((race) => {
                const isFeatured = featuredRound === race.round
                const isUpcoming = eventWindow(race).start > TODAY
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
                    <td title={formatDateTime(race.date, race.time)}>
                      {formatDate(race.date, race.time)}
                    </td>
                    <td className="table__action">
                      <div className="table__actions">
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => setInfoRound(race.round)}
                          aria-label={`${race.Circuit.circuitName} information`}
                        >
                          Info
                        </button>
                        {isUpcoming ? (
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => setDetailsRound(race.round)}
                            aria-label={`${race.raceName} session details`}
                          >
                            Details
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => onSelectRace(race.round)}
                          >
                            Results
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {detailsRace && (
        <Modal label={`${detailsRace.raceName} details`} onClose={() => setDetailsRound(null)}>
          <FeaturedEventPanel
            featured={eventFor(detailsRace)}
            // "Next up" is a claim about the featured round only; other future
            // rounds just carry their countdown.
            showBadge={detailsRace.round === featuredRound}
          />
        </Modal>
      )}

      {infoRace && (
        <Modal
          label={`${infoRace.Circuit.circuitName} information`}
          onClose={() => setInfoRound(null)}
        >
          <CircuitInfoPanel race={infoRace} />
        </Modal>
      )}
    </>
  )
}

import { useState } from 'react'
import type { Race } from '../api/types'
import { api } from '../api/client'
import { useFetch } from '../hooks/useFetch'
import { CIRCUITS, circuitLayoutImage } from '../lib/circuits'
import { summariseCircuit } from '../lib/circuitHistory'
import { ErrorState, Loading } from './Feedback'

/** "1950-1954,1956" -> "1950–1954, 1956": en dashes and breathing room. */
function seasonLabel(seasons: string): string {
  return seasons.replace(/-/g, '–').replace(/,/g, ', ')
}

/**
 * Everything the app knows about a circuit, gathered for the schedule's info
 * popup: the vendored track layout, its coordinates and Wikipedia link, its
 * racing history (past winners) and the evolution of its layout over the years.
 */
export function CircuitInfoPanel({ race }: { race: Race }) {
  const { Circuit } = race
  const { Location } = Circuit
  const circuitId = Circuit.circuitId

  const layout = CIRCUITS[circuitId]

  // Which configuration is on show: the circuit's current one until the reader
  // picks another from the layout history. The guard means a stale id — from a
  // different circuit — can never point at a missing file.
  const [selected, setSelected] = useState<string | null>(null)
  const selectedId =
    selected && layout?.layouts.some((entry) => entry.layoutId === selected)
      ? selected
      : (layout?.current ?? null)
  const shown = layout?.layouts.find((entry) => entry.layoutId === selectedId)
  const isCurrentLayout = selectedId !== null && selectedId === layout?.current
  const image = selectedId ? circuitLayoutImage(selectedId) : undefined

  const { data, loading, error, reload } = useFetch(
    (signal) => api.circuitWinners(circuitId, signal),
    [circuitId],
  )
  const history = data ? summariseCircuit(data.MRData.RaceTable.Races) : null

  const mapUrl = `https://www.openstreetmap.org/?mlat=${Location.lat}&mlon=${Location.long}#map=14/${Location.lat}/${Location.long}`

  return (
    <section className="circuit" aria-labelledby="circuit-info-title">
      <header className="circuit__head">
        <h2 className="circuit__title" id="circuit-info-title">
          {Circuit.circuitName}
        </h2>
        <p className="circuit__subtitle">
          {Location.locality}, {Location.country}
        </p>
      </header>

      <figure className="circuit__figure">
        {image ? (
          <img
            className="circuit__map"
            src={image}
            alt={`${Circuit.circuitName} track layout${
              shown ? ` from ${seasonLabel(shown.seasons)}` : ''
            }`}
          />
        ) : (
          <p className="circuit__map circuit__map--missing">
            No track layout available for this circuit yet.
          </p>
        )}
        {shown && (
          <figcaption className="circuit__caption">
            {isCurrentLayout ? 'Layout in use' : 'Layout used'} · {seasonLabel(shown.seasons)}
          </figcaption>
        )}
      </figure>

      <dl className="circuit__facts">
        <div className="circuit__fact">
          <dt>Coordinates</dt>
          <dd>
            <a href={mapUrl} target="_blank" rel="noreferrer">
              {Location.lat}, {Location.long}
            </a>
          </dd>
        </div>
        <div className="circuit__fact">
          <dt>Circuit</dt>
          <dd>
            <a href={Circuit.url} target="_blank" rel="noreferrer">
              Wikipedia
            </a>
          </dd>
        </div>
      </dl>

      <div className="circuit__section">
        <h3 className="circuit__section-title">Racing history</h3>

        {loading && <Loading message="Loading history…" />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {history && history.editions > 0 && (
          <>
            <dl className="circuit__stats">
              <div className="circuit__stat">
                <dt>Grands Prix</dt>
                <dd>{history.editions}</dd>
              </div>
              <div className="circuit__stat">
                <dt>First held</dt>
                <dd>{history.firstSeason}</dd>
              </div>
              <div className="circuit__stat">
                <dt>Most wins (driver)</dt>
                <dd>
                  {history.topDriver?.name}
                  <span className="circuit__count">{history.topDriver?.wins}×</span>
                </dd>
              </div>
              <div className="circuit__stat">
                <dt>Most wins (team)</dt>
                <dd>
                  {history.topConstructor?.name}
                  <span className="circuit__count">{history.topConstructor?.wins}×</span>
                </dd>
              </div>
            </dl>

            <h4 className="circuit__subhead">Recent winners</h4>
            <div className="table-wrap">
              <table className="table circuit__recent">
                <thead>
                  <tr>
                    <th scope="col" className="table__round">
                      Year
                    </th>
                    <th scope="col">Winner</th>
                    <th scope="col" className="hide-sm">
                      Team
                    </th>
                    <th scope="col" className="table__num">
                      Fastest lap
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.recent.map((entry) => (
                    <tr key={entry.season}>
                      <td className="table__round">{entry.season}</td>
                      <td>{entry.driver}</td>
                      <td className="muted hide-sm">{entry.constructor}</td>
                      <td className="table__num">{entry.fastestLap ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {history && history.editions === 0 && (
          <p className="circuit__none">No races have been held at this circuit yet.</p>
        )}
      </div>

      {layout && layout.layouts.length > 1 && (
        <div className="circuit__section">
          <h3 className="circuit__section-title">Layout history</h3>
          <ul className="circuit__layouts">
            {layout.layouts.map((entry) => (
              <li key={entry.layoutId}>
                <button
                  type="button"
                  className={`circuit__layout${entry.layoutId === selectedId ? ' is-selected' : ''}`}
                  onClick={() => setSelected(entry.layoutId)}
                  aria-pressed={entry.layoutId === selectedId}
                >
                  <span className="circuit__layout-seasons">{seasonLabel(entry.seasons)}</span>
                  {entry.layoutId === layout.current && (
                    <span className="circuit__layout-tag">Current</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

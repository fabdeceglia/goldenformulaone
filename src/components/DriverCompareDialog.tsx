import { useEffect, useState } from 'react'
import { fetchDriverCompare } from '../api/compareDrivers'
import { readableInk, teamColor } from '../api/teams'
import type { DriverStanding } from '../api/types'
import { MAX_COMPARE_DRIVERS, COMPARE_AXES } from '../lib/driverCompare'
import type { CompareAxisId, DriverCompareStat } from '../lib/driverCompare'
import { driverName } from '../lib/format'
import { CompareRadar } from './CompareRadar'
import { Empty, ErrorState, Loading } from './Feedback'
import { Modal } from './Modal'

interface DriverCompareDialogProps {
  season: string
  /** The standings rows, which are also the picker's driver list. */
  standings: readonly DriverStanding[]
  onClose: () => void
}

/** Selection order, so the series keep their colour when one is removed. */
const SERIES_COLORS = [
  'var(--compare-1)',
  'var(--compare-2)',
  'var(--compare-3)',
  'var(--compare-4)',
]

interface CompareRow {
  id: CompareAxisId
  /** The radar's labels are short to fit the spokes; the table can spell it out. */
  label: string
  detail: (stat: DriverCompareStat) => string
}

const ROWS: readonly CompareRow[] = [
  {
    id: 'wins',
    label: 'Wins',
    detail: ({ counts }) => `${counts.wins} of ${counts.starts} starts`,
  },
  {
    id: 'poles',
    label: 'Poles',
    detail: ({ counts }) =>
      counts.qualifyingSessions === 0
        ? 'no qualifying data'
        : `${counts.poles} of ${counts.qualifyingSessions} sessions`,
  },
  {
    id: 'qualifying',
    label: 'Qualifying vs team mate',
    detail: ({ counts }) =>
      counts.headToHeadWins + counts.headToHeadLosses === 0
        ? 'no team mate data'
        : `${counts.headToHeadWins}–${counts.headToHeadLosses}`,
  },
  {
    id: 'fastestLaps',
    label: 'Fastest laps',
    detail: ({ counts }) => `${counts.fastestLaps} of ${counts.starts} starts`,
  },
  {
    id: 'finishes',
    label: 'Finishes',
    detail: ({ counts }) => `${counts.retirements} retirements`,
  },
]

/**
 * Up to four drivers on one radar, picked from the standings list. The dialog
 * owns its own loading: a selection change re-runs the fetch, and the previous
 * shapes stay on screen until the new ones arrive.
 */
export function DriverCompareDialog({ season, standings, onClose }: DriverCompareDialogProps) {
  // Two is the smallest useful comparison, so the chart is there on open.
  const [selected, setSelected] = useState<string[]>(() =>
    standings.slice(0, 2).map((standing) => standing.Driver.driverId),
  )
  const [stats, setStats] = useState<DriverCompareStat[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const selectionKey = selected.join('|')

  useEffect(() => {
    if (selected.length < 2) {
      setStats(null)
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const byId = new Map(standings.map((standing) => [standing.Driver.driverId, standing]))
    const entries = selected.map((driverId) => ({
      driverId,
      constructorId: byId.get(driverId)?.Constructors[0]?.constructorId,
    }))

    setLoading(true)
    setError(null)

    fetchDriverCompare(season, entries, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setStats(result)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setStats(null)
        setError(cause instanceof Error ? cause.message : 'Something went wrong')
        setLoading(false)
      })

    return () => controller.abort()
    // `selectionKey` stands in for the array so the effect tracks the picks only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, selectionKey, nonce])

  const atCap = selected.length >= MAX_COMPARE_DRIVERS
  const slots = new Map(selected.map((driverId, index) => [driverId, index]))

  const toggle = (driverId: string) => {
    setSelected((current) => {
      if (current.includes(driverId)) return current.filter((id) => id !== driverId)
      if (current.length >= MAX_COMPARE_DRIVERS) return current
      return [...current, driverId]
    })
  }

  const standingsById = new Map(standings.map((standing) => [standing.Driver.driverId, standing]))
  const statsById = new Map((stats ?? []).map((stat) => [stat.driverId, stat]))

  // Matched by id rather than by position: the previous result is still mounted
  // while the next selection loads, and its order no longer matches.
  const picked = selected.flatMap((driverId, index) => {
    const standing = standingsById.get(driverId)
    const stat = statsById.get(driverId)
    if (!standing || !stat) return []
    return [
      {
        driverId,
        standing,
        stat,
        color: SERIES_COLORS[index],
        name: driverName(standing.Driver),
        short: standing.Driver.code ?? driverName(standing.Driver),
        team: standing.Constructors[0]?.name ?? '—',
      },
    ]
  })

  return (
    <Modal label={`Driver comparison for ${season}`} size="wide" onClose={onClose}>
      <div className="compare">
        <header className="compare__head">
          <h2 className="compare__title">Driver comparison</h2>
          <p className="compare__meta">
            {season} season · pick up to {MAX_COMPARE_DRIVERS} drivers
          </p>
        </header>

        <div className="compare__body">
          <section className="compare__picker" aria-label="Drivers to compare">
            <div className="compare__picker-head">
              <span>Drivers</span>
              <span className="compare__count" aria-live="polite">
                {selected.length} / {MAX_COMPARE_DRIVERS}
              </span>
            </div>
            <div className="compare__list-wrap">
              <ul className="compare__list">
                {standings.map((standing) => {
                  const driverId = standing.Driver.driverId
                  const slot = slots.get(driverId)
                  const isSelected = slot !== undefined
                  const blocked = atCap && !isSelected
                  const livery = teamColor(standing.Constructors[0]?.constructorId)

                  return (
                    <li key={driverId}>
                      <button
                        type="button"
                        className="compare__row"
                        aria-pressed={isSelected}
                        aria-disabled={blocked}
                        title={
                          blocked ? 'Four is the maximum — deselect a driver first' : undefined
                        }
                        onClick={() => {
                          if (!blocked) toggle(driverId)
                        }}
                      >
                        <span
                          className="compare__slot"
                          data-slot={isSelected ? slot + 1 : undefined}
                          aria-hidden="true"
                        >
                          {isSelected ? slot + 1 : '+'}
                        </span>
                        <span
                          className="compare__code"
                          style={{ backgroundColor: livery, color: readableInk(livery) }}
                          aria-hidden="true"
                        >
                          {standing.Driver.code ?? standing.Driver.permanentNumber ?? '—'}
                        </span>
                        <span className="compare__name">{driverName(standing.Driver)}</span>
                        <span className="compare__team">
                          {standing.Constructors[0]?.name ?? '—'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>

          <div className="compare__plot">
            {selected.length < 2 ? (
              <Empty message="Pick at least two drivers to compare." />
            ) : error ? (
              <ErrorState message={error} onRetry={() => setNonce((value) => value + 1)} />
            ) : loading && !stats ? (
              <Loading message="Loading season data…" />
            ) : picked.length < 2 ? (
              <Empty message="No season data for the selected drivers yet." />
            ) : (
              <>
                <CompareRadar
                  axes={COMPARE_AXES}
                  series={picked.map((entry) => ({
                    driverId: entry.driverId,
                    label: entry.name,
                    color: entry.color,
                    values: entry.stat.values,
                  }))}
                />

                <ul className="compare__legend">
                  {picked.map((entry) => (
                    <li key={entry.driverId} className="compare__legend-item">
                      <span
                        className="compare__swatch"
                        style={{ backgroundColor: entry.color }}
                        aria-hidden="true"
                      />
                      <span className="compare__legend-name">{entry.name}</span>
                      <span className="compare__legend-team">{entry.team}</span>
                    </li>
                  ))}
                </ul>

                <p className="compare__caption">
                  Each spoke is scaled to the strongest of the selected drivers. The table holds the
                  absolute numbers.
                </p>

                <table className="compare__table">
                  <caption className="sr-only">Season statistics for the selected drivers</caption>
                  <thead>
                    <tr>
                      <th scope="col">Stat</th>
                      {picked.map((entry) => (
                        <th scope="col" key={entry.driverId}>
                          {entry.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">{row.label}</th>
                        {picked.map((entry) => (
                          <td key={entry.driverId}>
                            <strong>{percent(entry.stat.values[row.id])}</strong>
                            <span>{row.detail(entry.stat)}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {loading && (
                  <p className="compare__pending" role="status">
                    Updating…
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

import { useEffect, useRef, useState } from 'react'
import type { CompareAxis, CompareStat } from '../lib/compare'
import { MAX_COMPARE_SERIES } from '../lib/compare'
import { CompareRadar } from './CompareRadar'
import { Empty, ErrorState, Loading } from './Feedback'
import { Modal } from './Modal'

/** One row of the picker. */
export interface CompareOption {
  id: string
  name: string
  /** Secondary line under the name: the team, or the team's nationality. */
  detail: string
  /** Chip text. Omitted when the entity has no marking of its own. */
  code?: string
  color: string
  /** Ink that reads on `color`. */
  ink: string
}

/** One row of the comparison table: the share, then the counts behind it. */
export interface CompareRow<Stat extends CompareStat> {
  id: string
  label: string
  detail: (stat: Stat) => string
}

interface CompareDialogProps<Stat extends CompareStat> {
  season: string
  /** Dialog heading, e.g. "Driver comparison". */
  title: string
  /** Accessible name for the modal. */
  label: string
  /** Plural noun the picker counts: "drivers" or "teams". */
  noun: string
  options: readonly CompareOption[]
  /** Ids picked when the dialog opens. */
  initial: readonly string[]
  axes: readonly CompareAxis[]
  rows: readonly CompareRow<Stat>[]
  idOf: (stat: Stat) => string
  /** Resolve the picked ids to their stats, in the same order. */
  load: (ids: readonly string[], signal: AbortSignal) => Promise<Stat[]>
  onClose: () => void
}

/** Selection order, so the series keep their colour when one is removed. */
const SERIES_COLORS = [
  'var(--compare-1)',
  'var(--compare-2)',
  'var(--compare-3)',
  'var(--compare-4)',
]

/**
 * The shared shell of both comparison dialogs: a capped picker on the left, the
 * radar and its counts on the right. The two differ only in what a pick is and
 * which axes it exposes, so those arrive as props and the rest is written once.
 *
 * The dialog owns its own loading: a selection change re-runs `load`, and the
 * previous shapes stay on screen until the new ones arrive.
 */
export function CompareDialog<Stat extends CompareStat>({
  season,
  title,
  label,
  noun,
  options,
  initial,
  axes,
  rows,
  idOf,
  load,
  onClose,
}: CompareDialogProps<Stat>) {
  // Two is the smallest useful comparison, so the chart is there on open.
  const [selected, setSelected] = useState<string[]>(() => initial.slice(0, MAX_COMPARE_SERIES))
  const [stats, setStats] = useState<Stat[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // A new selection aborts the old request; `load` is read through a ref so the
  // effect below does not have to depend on a callback that changes identity.
  const loadRef = useRef(load)
  loadRef.current = load

  const selectionKey = selected.join('|')

  useEffect(() => {
    if (selected.length < 2) {
      setStats(null)
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    loadRef
      .current(selected, controller.signal)
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

  const atCap = selected.length >= MAX_COMPARE_SERIES
  const slots = new Map(selected.map((id, index) => [id, index]))

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id)
      if (current.length >= MAX_COMPARE_SERIES) return current
      return [...current, id]
    })
  }

  const optionsById = new Map(options.map((option) => [option.id, option]))
  const statsById = new Map((stats ?? []).map((stat) => [idOf(stat), stat]))

  // Matched by id rather than by position: the previous result is still mounted
  // while the next selection loads, and its order no longer matches.
  const picked = selected.flatMap((id, index) => {
    const option = optionsById.get(id)
    const stat = statsById.get(id)
    if (!option || !stat) return []
    return [{ option, stat, color: SERIES_COLORS[index] }]
  })

  return (
    <Modal label={label} size="wide" onClose={onClose}>
      <div className="compare">
        <header className="compare__head">
          <h2 className="compare__title">{title}</h2>
          <p className="compare__meta">
            {season} season · pick up to {MAX_COMPARE_SERIES} {noun}
          </p>
        </header>

        <div className="compare__body">
          <section className="compare__picker" aria-label={`${title} selection`}>
            <div className="compare__picker-head">
              <span>{noun}</span>
              <span className="compare__count" aria-live="polite">
                {selected.length} / {MAX_COMPARE_SERIES}
              </span>
            </div>
            <div className="compare__list-wrap">
              <ul className="compare__list">
                {options.map((option) => {
                  const slot = slots.get(option.id)
                  const isSelected = slot !== undefined
                  const blocked = atCap && !isSelected

                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        className="compare__row"
                        aria-pressed={isSelected}
                        aria-disabled={blocked}
                        title={blocked ? 'Four is the maximum — deselect one first' : undefined}
                        onClick={() => {
                          if (!blocked) toggle(option.id)
                        }}
                      >
                        <span
                          className="compare__slot"
                          data-slot={isSelected ? slot + 1 : undefined}
                          aria-hidden="true"
                        >
                          {isSelected ? slot + 1 : '+'}
                        </span>
                        {option.code ? (
                          <span
                            className="compare__code"
                            style={{ backgroundColor: option.color, color: option.ink }}
                            aria-hidden="true"
                          >
                            {option.code}
                          </span>
                        ) : (
                          <span
                            className="compare__code compare__code--plain"
                            style={{ backgroundColor: option.color }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="compare__name">{option.name}</span>
                        <span className="compare__team">{option.detail}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>

          <div className="compare__plot">
            {selected.length < 2 ? (
              <Empty message={`Pick at least two ${noun} to compare.`} />
            ) : error ? (
              <ErrorState message={error} onRetry={() => setNonce((value) => value + 1)} />
            ) : loading && !stats ? (
              <Loading message="Loading season data…" />
            ) : picked.length < 2 ? (
              <Empty message="No season data for the selection yet." />
            ) : (
              <>
                <CompareRadar
                  axes={axes}
                  series={picked.map((entry) => ({
                    id: entry.option.id,
                    label: entry.option.name,
                    color: entry.color,
                    values: entry.stat.values,
                  }))}
                />

                <ul className="compare__legend">
                  {picked.map((entry) => (
                    <li key={entry.option.id} className="compare__legend-item">
                      <span
                        className="compare__swatch"
                        style={{ backgroundColor: entry.color }}
                        aria-hidden="true"
                      />
                      <span className="compare__legend-name">{entry.option.name}</span>
                      <span className="compare__legend-team">{entry.option.detail}</span>
                    </li>
                  ))}
                </ul>

                <p className="compare__caption">
                  Each spoke is scaled to the strongest of the selection. The table holds the
                  absolute numbers.
                </p>

                <table className="compare__table">
                  <caption className="sr-only">Season statistics for the selection</caption>
                  <thead>
                    <tr>
                      <th scope="col">Stat</th>
                      {picked.map((entry) => (
                        <th scope="col" key={entry.option.id}>
                          {entry.option.code ?? entry.option.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">{row.label}</th>
                        {picked.map((entry) => (
                          <td key={entry.option.id}>
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

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
}

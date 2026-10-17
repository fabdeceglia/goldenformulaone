import { useMemo, useState } from 'react'
import { SESSION_CODES, alpha } from '../api/alpha'
import type { Race, SessionCode } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { formatDateTime } from '../lib/format'
import { NOW_MILLIS, defaultSession, raceSchedule } from '../lib/schedule'
import { Empty, ErrorState, Loading } from './Feedback'
import { SessionResultTable } from './SessionResultTable'
import { Tabs } from './Tabs'
import type { Tab } from './Tabs'

interface RaceResultsProps {
  season: string
  races: Race[]
  round: string
  /** Alpha round id for the selected round, when one could be resolved. */
  roundId: string | undefined
  onRoundChange: (round: string) => void
}

export function RaceResults({ season, races, round, roundId, onRoundChange }: RaceResultsProps) {
  const [sessionChoice, setSessionChoice] = useState<SessionCode | null>(null)

  const selectedRace = races.find((race) => race.round === round)

  // The alpha API reports which sessions the round actually ran, so sprint
  // weekends list practice 1 plus sprint qualifying and the sprint, rather than
  // practice 2 and 3.
  const {
    data: index,
    loading: indexLoading,
    error: indexError,
    reload: reloadIndex,
  } = useFetch(roundId ? (signal) => alpha.resultsIndex(roundId, signal) : null, [roundId])

  const sessionTabs = useMemo<readonly Tab<SessionCode>[]>(() => {
    const tabs = (index?.available_results ?? [])
      .filter((available) => (SESSION_CODES as readonly string[]).includes(available.code))
      .map((available) => ({ id: available.code as SessionCode, label: available.title }))

    if (!selectedRace) return tabs

    // The results index lists sessions backwards (R, Q, SQ, SR, FP1), so order
    // them the way the weekend actually runs.
    const order = new Map(raceSchedule(selectedRace).map((entry, i) => [entry.code, i]))
    return [...tabs].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
  }, [index, selectedRace])

  const fallback = useMemo(() => defaultSession(selectedRace, NOW_MILLIS), [selectedRace])

  // Keep an explicit choice while it is valid for the selected round, otherwise
  // default to the most recent session that has already started.
  const session = useMemo<SessionCode>(() => {
    const codes = sessionTabs.map((tab) => tab.id)
    if (sessionChoice && codes.includes(sessionChoice)) return sessionChoice
    if (codes.includes(fallback)) return fallback
    return codes[codes.length - 1] ?? 'R'
  }, [sessionChoice, sessionTabs, fallback])

  const { data, loading, error, reload } = useFetch(
    roundId && sessionTabs.length > 0
      ? (signal) => alpha.session(roundId, session, signal)
      : null,
    [roundId, session, sessionTabs.length],
  )

  const sessionLabel = sessionTabs.find((tab) => tab.id === session)?.label ?? session

  return (
    <section className="panel" aria-labelledby="results-title">
      <div className="panel__head panel__head--stack">
        <div>
          <h2 className="panel__title" id="results-title">
            {selectedRace ? selectedRace.raceName : `${season} Results`}
          </h2>
          {selectedRace && (
            <p className="panel__subtitle">
              {selectedRace.Circuit.circuitName}, {selectedRace.Circuit.Location.country} ·{' '}
              {formatDateTime(selectedRace.date, selectedRace.time)}
            </p>
          )}
        </div>

        <label className="field">
          <span className="field__label">Round</span>
          <select
            className="field__select"
            value={round}
            disabled={races.length === 0}
            onChange={(event) => onRoundChange(event.target.value)}
          >
            {races.length === 0 && <option value="">—</option>}
            {races.map((item) => (
              <option key={item.round} value={item.round}>
                {item.round}. {item.raceName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sessionTabs.length > 0 && (
        <div className="panel__subhead">
          <Tabs
            tabs={sessionTabs}
            active={session}
            onChange={setSessionChoice}
            ariaLabel="Session"
            variant="compact"
          />
        </div>
      )}

      {!round && <Empty message="Select a round to see its results." />}
      {round && !roundId && (
        <Empty message={`Results are not available for round ${round}.`} />
      )}
      {roundId && indexLoading && <Loading message="Loading sessions…" />}
      {indexError && <ErrorState message={indexError} onRetry={reloadIndex} />}

      {loading && !error && (
        <Loading message={`Loading ${sessionLabel.toLowerCase()} results…`} />
      )}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && !loading && !error && data.results.length === 0 && (
        <Empty
          message={`${sessionLabel} results for round ${round} are not available yet.`}
        />
      )}

      {data && !loading && !error && data.results.length > 0 && (
        <SessionResultTable session={data} />
      )}
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { SESSION_CODES, alpha } from '../api/alpha'
import { isPracticeSession, practiceResults } from '../api/openf1Results'
import type { AlphaSessionResults, Race, SessionCode } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { useNow } from '../hooks/useNow'
import { clockNow } from '../lib/clock'
import { formatDateTime } from '../lib/format'
import {
  NOW_MILLIS,
  defaultSession,
  raceSchedule,
  resultsPollDelay,
  sessionPhase,
} from '../lib/schedule'
import { Empty, ErrorState, Loading } from './Feedback'
import { ReplayDialog } from './ReplayDialog'
import { SessionResultTable } from './SessionResultTable'
import { StartingGridView } from './StartingGridView'
import { Tabs } from './Tabs'
import type { Tab } from './Tabs'

interface RaceResultsProps {
  season: string
  races: Race[]
  round: string
  /** Alpha round id for the selected round, when one could be resolved. */
  roundId: string | undefined
  /** The season-wide round-id lookup is still in flight or failed. */
  roundsLoading: boolean
  roundsError: string | null
  onRetryRounds: () => void
  /** Session to open first, e.g. the one the hero sent the visitor to see. */
  initialSession?: SessionCode | null
  onRoundChange: (round: string) => void
}

/** The practice fallback either produced a provisional table or has nothing. */
type PracticeFallback =
  | { status: 'ready'; session: AlphaSessionResults }
  | { status: 'unavailable' }

export function RaceResults({
  season,
  races,
  round,
  roundId,
  roundsLoading,
  roundsError,
  onRetryRounds,
  initialSession,
  onRoundChange,
}: RaceResultsProps) {
  const [sessionChoice, setSessionChoice] = useState<SessionCode | null>(initialSession ?? null)
  const [view, setView] = useState<'table' | 'grid'>('table')
  const [replayOpen, setReplayOpen] = useState(false)

  const selectedRace = races.find((race) => race.round === round)

  // The alpha API reports which sessions the round actually ran, so sprint
  // weekends list practice 1 plus sprint qualifying and the sprint, rather than
  // practice 2 and 3.
  const {
    data: index,
    loading: indexLoading,
    error: indexError,
    reload: reloadIndex,
    refresh: refreshIndex,
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

  const {
    data,
    loading,
    error,
    reload,
    refresh: refreshSession,
  } = useFetch(
    roundId && sessionTabs.length > 0
      ? (signal) => alpha.session(roundId, session, signal)
      : null,
    [roundId, session, sessionTabs.length],
  )

  const sessionLabel = sessionTabs.find((tab) => tab.id === session)?.label ?? session

  const now = useNow()
  const selectedEntry = useMemo(
    () =>
      selectedRace
        ? raceSchedule(selectedRace).find((entry) => entry.code === session)
        : undefined,
    [selectedRace, session],
  )

  // A replay needs the flag plus OpenF1's thirty-minute free-tier window, and
  // only race and sprint classifications have a replay at all.
  const replaySession = session === 'R' || session === 'SR'
  const replayUnlocked = selectedEntry
    ? sessionPhase(selectedEntry, now - 30 * 60_000) === 'finished'
    : false
  const replayReady = replaySession && replayUnlocked
  const replayHint = !replaySession
    ? 'Replay is available for races and sprints.'
    : !selectedEntry
      ? 'Replay will be available after the session starts.'
      : !replayUnlocked
        ? 'Replay will be available about 30 minutes after the chequered flag.'
        : undefined

  // The API gives no "published at" signal, so the app only polls inside the
  // window where a result can plausibly arrive. Opening Abu Dhabi in October
  // therefore stays a single request; leaving the results tab open after the
  // flag keeps checking until the classification appears.
  const pollDelay = selectedEntry ? resultsPollDelay(selectedEntry, now) : null
  const hasResults = (data?.results.length ?? 0) > 0

  // Practice is the one session jolpica has been slow to publish, so show
  // OpenF1's provisional classification while the canonical one is missing.
  // OpenF1 is free from about thirty minutes after the flag, so early attempts
  // fail closed and the poll below retries them.
  const practice = isPracticeSession(session)
  const sessionFinished = selectedEntry
    ? sessionPhase(selectedEntry, now) === 'finished'
    : false
  const wantPracticeFallback =
    practice &&
    sessionFinished &&
    !loading &&
    (!!error || (data?.results.length ?? 0) === 0)

  const {
    data: practiceFallback,
    loading: fallbackLoading,
    error: fallbackError,
    refresh: refreshFallback,
  } = useFetch<PracticeFallback>(
    wantPracticeFallback && selectedRace
      ? async (signal) => {
          const provisional = await practiceResults(selectedRace, session, roundId, signal)
          return provisional
            ? { status: 'ready' as const, session: provisional }
            : { status: 'unavailable' as const }
        }
      : null,
    [wantPracticeFallback, selectedRace, session, roundId],
  )

  const fallbackSession =
    practiceFallback?.status === 'ready' ? practiceFallback.session : null
  const usingFallback = fallbackSession !== null && !hasResults && !loading
  // While OpenF1 is being asked, "not published yet" would be wrong: the
  // fallback may already have the classification. Only show that notice once
  // the attempt has settled without a table.
  const fallbackPending =
    wantPracticeFallback && !fallbackError && (fallbackLoading || practiceFallback === null)

  const pollTarget: 'index' | 'session' | null =
    pollDelay === null || !roundId
      ? null
      : sessionTabs.length === 0
        ? !indexLoading && !indexError
          ? 'index'
          : null
        : !loading && !error && !hasResults
          ? 'session'
          : null

  useEffect(() => {
    if (pollTarget === null || pollDelay === null) return

    let cancelled = false
    let timer = 0

    const check = async () => {
      if (cancelled) return
      if (pollTarget === 'index') {
        await refreshIndex()
      } else {
        await refreshSession()
        await refreshFallback()
      }

      if (cancelled) return
      const next = selectedEntry ? resultsPollDelay(selectedEntry, clockNow()) : null
      if (next !== null) timer = window.setTimeout(check, next)
    }

    // Timers are throttled in a hidden tab. Checking as soon as the visitor
    // comes back avoids making them wait for the next five-minute slot.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (pollTarget === 'index') {
        void refreshIndex()
      } else {
        void refreshSession()
        void refreshFallback()
      }
    }

    timer = window.setTimeout(check, pollDelay)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [pollTarget, pollDelay, selectedEntry, refreshIndex, refreshSession, refreshFallback])

  const pendingMessage = (label: string) => {
    if (pollDelay !== null) {
      return `${label} results are not published yet — checking again automatically.`
    }
    if (selectedEntry && sessionPhase(selectedEntry, now) !== 'finished') {
      return `${label} results will be available after the session.`
    }
    return `${label} results are not available.`
  }

  const pendingRoundMessage =
    pollDelay !== null
      ? 'Results are not published yet — checking again automatically.'
      : selectedEntry && sessionPhase(selectedEntry, now) !== 'finished'
        ? 'Results will be available after the session.'
        : 'Results are not available for this round.'

  // Only qualifying has a starting grid to show, and the toggle is the only way
  // to reach it: every other session stays on the table it has always had.
  const gridAvailable = session === 'Q' || session === 'SQ'
  const showingGrid = gridAvailable && view === 'grid'

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

          <div className="results-actions">
            {gridAvailable && (
              <div className="view-toggle" role="group" aria-label="Results view">
                <button
                  type="button"
                  className="view-toggle__button"
                  aria-pressed={view === 'table'}
                  onClick={() => setView('table')}
                >
                  Table
                </button>
                <button
                  type="button"
                  className="view-toggle__button"
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                >
                  Grid
                </button>
              </div>
            )}

            {/* Always rendered so the action is discoverable; the reason it is
                unavailable is carried by the description rather than a error
                once the dialog opens. */}
            <button
              type="button"
              className="button button--ghost replay-open"
              aria-disabled={!replayReady}
              title={replayHint}
              aria-describedby={replayHint ? 'replay-hint' : undefined}
              onClick={() => {
                if (replayReady) setReplayOpen(true)
              }}
            >
              Replay
            </button>
            {replayHint && (
              <span className="sr-only" id="replay-hint">
                {replayHint}
              </span>
            )}
          </div>
        </div>
      )}

      {!round && <Empty message="Select a round to see its results." />}
      {round && !roundId && roundsLoading && (
        <Loading message="Loading the results index…" />
      )}
      {round && !roundId && !roundsLoading && roundsError && (
        <ErrorState message={roundsError} onRetry={onRetryRounds} />
      )}
      {round && !roundId && !roundsLoading && !roundsError && (
        <Empty message={`Results are not available for round ${round}.`} />
      )}
      {roundId && indexLoading && <Loading message="Loading sessions…" />}
      {indexError && <ErrorState message={indexError} onRetry={reloadIndex} />}

      {/* A round can be on the calendar before the API lists any of its
          sessions, which is the other half of "not published yet". */}
      {roundId && !indexLoading && !indexError && sessionTabs.length === 0 && (
        <Empty message={pendingRoundMessage} />
      )}

      {loading && !error && (
        <Loading message={`Loading ${sessionLabel.toLowerCase()} results…`} />
      )}
      {fallbackPending && !usingFallback && (
        <Loading message="Checking OpenF1 for a provisional classification…" />
      )}
      {error && !usingFallback && !fallbackPending && (
        <ErrorState message={error} onRetry={reload} />
      )}

      {data &&
        !loading &&
        !error &&
        data.results.length === 0 &&
        !usingFallback &&
        !fallbackPending && <Empty message={pendingMessage(sessionLabel)} />}

      {usingFallback && fallbackSession && (
        <>
          <p className="results-note">
            Provisional classification from OpenF1 — jolpica has not published this session
            yet.
          </p>
          <SessionResultTable session={fallbackSession} />
        </>
      )}

      {data && !loading && !error && data.results.length > 0 && (
        showingGrid ? <StartingGridView session={data} /> : <SessionResultTable session={data} />
      )}

      {replayOpen && replaySession && selectedRace && (
        <ReplayDialog
          key={`${selectedRace.season}-${selectedRace.round}-${session}`}
          race={selectedRace}
          code={session}
          onClose={() => setReplayOpen(false)}
        />
      )}
    </section>
  )
}

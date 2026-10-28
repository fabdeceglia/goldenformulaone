import { useEffect, useMemo, useState } from 'react'
import { SESSION_CODES, alpha } from '../api/alpha'
import { sessionResults } from '../api/resultsService'
import type { ResultsResponse } from '../api/resultsService'
import type { Race, SessionCode } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { useNow } from '../hooks/useNow'
import { formatDateTime } from '../lib/format'
import { defaultSession, raceSchedule, sessionPhase } from '../lib/schedule'
import { BattleDialog } from './BattleDialog'
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
  /** Session to open first, e.g. the one the hero sent the visitor to see. */
  initialSession?: SessionCode | null
  onRoundChange: (round: string) => void
}

export function RaceResults({
  season,
  races,
  round,
  roundId,
  initialSession,
  onRoundChange,
}: RaceResultsProps) {
  const [sessionChoice, setSessionChoice] = useState<SessionCode | null>(initialSession ?? null)
  const [view, setView] = useState<'table' | 'grid'>('table')
  const [replayOpen, setReplayOpen] = useState(false)
  const [battleOpen, setBattleOpen] = useState(false)

  const selectedRace = races.find((race) => race.round === round)
  const now = useNow()

  // The results index is now only a label source. The tab list itself comes
  // from the calendar so a late alpha index cannot hide a Worker result.
  const { data: index } = useFetch(
    roundId ? (signal) => alpha.resultsIndex(roundId, signal) : null,
    [roundId],
  )

  const sessionTabs = useMemo<readonly Tab<SessionCode>[]>(() => {
    if (!selectedRace) return []

    const entries = raceSchedule(selectedRace)
    const order = new Map(entries.map((entry, index) => [entry.code, index]))
    const started = entries
      .filter((entry) => sessionPhase(entry, now) !== 'upcoming')
      .map((entry) => ({ id: entry.code, label: entry.label }))

    const known = new Set(started.map((tab) => tab.id))
    const extra = (index?.available_results ?? [])
      .filter((available) => (SESSION_CODES as readonly string[]).includes(available.code))
      .filter((available) => !known.has(available.code as SessionCode))
      .map((available) => ({ id: available.code as SessionCode, label: available.title }))

    return [...started, ...extra].sort(
      (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
    )
  }, [index, selectedRace, now])

  const defaultCode = useMemo(() => defaultSession(selectedRace, now), [selectedRace, now])

  // Keep an explicit choice while it is valid for the selected round, otherwise
  // default to the most recent session that has already started.
  const session = useMemo<SessionCode>(() => {
    const codes = sessionTabs.map((tab) => tab.id)
    if (sessionChoice && codes.includes(sessionChoice)) return sessionChoice
    if (codes.includes(defaultCode)) return defaultCode
    return codes[codes.length - 1] ?? defaultCode
  }, [sessionChoice, sessionTabs, defaultCode])

  const selectedEntry = useMemo(
    () =>
      selectedRace
        ? raceSchedule(selectedRace).find((entry) => entry.code === session)
        : undefined,
    [selectedRace, session],
  )
  const sessionStarted = selectedEntry ? sessionPhase(selectedEntry, now) !== 'upcoming' : false
  const sessionLabel =
    sessionTabs.find((tab) => tab.id === session)?.label ?? selectedEntry?.label ?? session

  // One request for every state: pending, provisional and final all carry the
  // same table shape, so the Worker is the only thing that knows the source.
  const { data, loading, error, reload, refresh } = useFetch<ResultsResponse>(
    selectedRace && sessionStarted
      ? (signal) => sessionResults(selectedRace.season, selectedRace.round, session, signal)
      : null,
    [selectedRace?.season, selectedRace?.round, session, sessionStarted],
  )

  // The Worker tells us how often to poll: 60 seconds while pending or
  // provisional, null once the result is final.
  const pollAfterMs = data?.pollAfterMs ?? null
  useEffect(() => {
    if (pollAfterMs === null) return

    let cancelled = false
    let timer = 0

    const check = async () => {
      if (cancelled) return
      await refresh()
      if (cancelled) return
      timer = window.setTimeout(check, pollAfterMs)
    }

    // Timers are throttled in a hidden tab. Checking as soon as the visitor
    // comes back avoids making them wait for the next slot.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    timer = window.setTimeout(check, pollAfterMs)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [pollAfterMs, refresh, selectedRace?.season, selectedRace?.round, session])

  const resultSession = data?.session ?? null
  const hasResults = (resultSession?.results.length ?? 0) > 0
  const usingProvisional = data?.state === 'provisional' && hasResults
  const openF1Locked = data?.state === 'pending' && data.sources.openf1.state === 'locked'

  const pendingMessage = (label: string) => {
    if (selectedEntry && sessionPhase(selectedEntry, now) === 'live') {
      return `${label} results will be available after the session.`
    }
    if (openF1Locked) {
      return 'OpenF1 is locked while another session is live. The provisional classification will return after the session.'
    }
    if (data?.pollAfterMs != null) {
      return `${label} results are not published yet — checking again automatically.`
    }
    if (selectedEntry && sessionPhase(selectedEntry, now) !== 'finished') {
      return `${label} results will be available after the session.`
    }
    return `${label} results are not available.`
  }

  // Only qualifying has a starting grid to show, and the toggle is the only way
  // to reach it: every other session stays on the table it has always had.
  const gridAvailable = session === 'Q' || session === 'SQ'
  const showingGrid = gridAvailable && view === 'grid'

  const replaySession = session === 'R' || session === 'SR'
  const battleCode: 'Q' | 'SQ' | null = session === 'Q' || session === 'SQ' ? session : null
  const sessionUnlocked = selectedEntry
    ? sessionPhase(selectedEntry, now - 30 * 60_000) === 'finished'
    : false
  const replayReady = replaySession && sessionUnlocked
  const replayHint = !replaySession
    ? 'Replay is available for races and sprints.'
    : !selectedEntry
      ? 'Replay will be available after the session starts.'
      : !sessionUnlocked
        ? 'Replay will be available about 30 minutes after the chequered flag.'
        : undefined
  const battleReady = battleCode !== null && sessionUnlocked
  const battleHint = !selectedEntry
    ? 'The 1v1 battle will be available after the session starts.'
    : !sessionUnlocked
      ? 'The 1v1 battle will be available about 30 minutes after the chequered flag.'
      : undefined

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

            {battleCode ? (
              <>
                <button
                  type="button"
                  className="button button--ghost battle-open"
                  aria-disabled={!battleReady}
                  title={battleHint}
                  aria-describedby={battleHint ? 'battle-hint' : undefined}
                  onClick={() => {
                    if (battleReady) setBattleOpen(true)
                  }}
                >
                  1v1 Battle
                </button>
                {battleHint && (
                  <span className="sr-only" id="battle-hint">
                    {battleHint}
                  </span>
                )}
              </>
            ) : (
              <>
                {/* Always rendered so the action is discoverable; the reason it
                    is unavailable is carried by the description rather than an
                    error once the dialog opens. */}
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
              </>
            )}
          </div>
        </div>
      )}

      {!round && <Empty message="Select a round to see its results." />}
      {round && !selectedRace && <Empty message={`Results are not available for round ${round}.`} />}

      {selectedRace && !sessionStarted && (
        <Empty message={pendingMessage(sessionLabel)} />
      )}

      {loading && !error && (
        <Loading message={`Loading ${sessionLabel.toLowerCase()} results…`} />
      )}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && !loading && !error && (
        <>
          {usingProvisional && (
            <p className="results-note">
              {data.source === 'openf1'
                ? 'Provisional classification from OpenF1 — jolpica has not published this session yet.'
                : 'Provisional classification from jolpica — the classification is not complete yet.'}
            </p>
          )}

          {hasResults && resultSession ? (
            showingGrid ? (
              <StartingGridView session={resultSession} />
            ) : (
              <SessionResultTable session={resultSession} />
            )
          ) : (
            <Empty message={pendingMessage(sessionLabel)} />
          )}
        </>
      )}

      {replayOpen && replaySession && selectedRace && (
        <ReplayDialog
          key={`${selectedRace.season}-${selectedRace.round}-${session}`}
          race={selectedRace}
          code={session}
          onClose={() => setReplayOpen(false)}
        />
      )}

      {battleOpen && battleCode && selectedRace && (
        <BattleDialog
          key={`battle-${selectedRace.season}-${selectedRace.round}-${battleCode}`}
          race={selectedRace}
          code={battleCode}
          onClose={() => setBattleOpen(false)}
        />
      )}
    </section>
  )
}

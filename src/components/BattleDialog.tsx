import { useCallback, useEffect, useRef, useState } from 'react'
import type { Race } from '../api/types'
import {
  battleDuration,
  battleStateAt,
  fastestLap,
  formatBattleDelta,
  formatBattleGap,
  lapDelta,
  sectorDeltas,
} from '../lib/battle'
import type { BattleSide, QualifyingBattle } from '../lib/battle'
import { formatLapTime } from '../lib/replay'
import { BattleUnavailableError, loadBattle, loadBattleSession } from '../lib/battleSource'
import type { BattleCode, BattleProgress, BattleSession } from '../lib/battleSource'
import { BattleCockpit } from './BattleCockpit'
import { BattleControls } from './BattleControls'
import { BattleTrack } from './BattleTrack'
import { ErrorState, Loading } from './Feedback'
import { Modal } from './Modal'

interface BattleDialogProps {
  race: Race
  code: BattleCode
  onClose: () => void
}

interface Pick {
  driver: number
  lap: number
}

type SessionState =
  | { status: 'loading'; progress: BattleProgress }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: BattleSession }

type BattleLoadState =
  | { status: 'idle' }
  | { status: 'loading'; progress: BattleProgress }
  | { status: 'error'; message: string }
  | { status: 'ready'; battle: QualifyingBattle }

const INITIAL_SESSION_PROGRESS: BattleProgress = {
  phase: 'session',
  label: 'Finding the session…',
  loaded: 0,
  total: 4,
}

const INITIAL_BATTLE_PROGRESS: BattleProgress = {
  phase: 'telemetry',
  label: 'Loading the selected laps…',
  loaded: 0,
  total: 4,
}

const ARROW_STEP = 1_000

/**
 * Qualifying 1v1: a setup step that loads the session and every timed lap, then
 * a battle step that owns one lap-relative playhead. The map, cockpits and gap
 * are pure views of that playhead, exactly like the race replay.
 */
export function BattleDialog({ race, code, onClose }: BattleDialogProps) {
  const [sessionState, setSessionState] = useState<SessionState>({
    status: 'loading',
    progress: INITIAL_SESSION_PROGRESS,
  })
  const [sessionAttempt, setSessionAttempt] = useState(0)

  const [pickA, setPickA] = useState<Pick | null>(null)
  const [pickB, setPickB] = useState<Pick | null>(null)

  const [request, setRequest] = useState<{ a: Pick; b: Pick } | null>(null)
  const [battleState, setBattleState] = useState<BattleLoadState>({ status: 'idle' })
  const [battleAttempt, setBattleAttempt] = useState(0)

  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const currentRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    loadBattleSession({
      race,
      code,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!cancelled) setSessionState({ status: 'loading', progress })
      },
    })
      .then((session) => {
        if (cancelled) return
        setSessionState({ status: 'ready', session })

        // Default to the two quickest drivers, each on their fastest lap, so
        // the setup screen is one click away from a meaningful battle.
        const [first, second] = session.ranked
        const firstLap = first ? fastestLap(session.laps.get(first.number) ?? []) : null
        const secondLap = second ? fastestLap(session.laps.get(second.number) ?? []) : null

        setPickA(first && firstLap ? { driver: first.number, lap: firstLap.lapNumber } : null)
        setPickB(second && secondLap ? { driver: second.number, lap: secondLap.lapNumber } : null)
      })
      .catch((cause: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setSessionState({ status: 'error', message: messageFor(cause) })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [race, code, sessionAttempt])

  const readySession = sessionState.status === 'ready' ? sessionState.session : null

  useEffect(() => {
    if (!readySession || !request) return

    const controller = new AbortController()
    let cancelled = false

    loadBattle({
      session: readySession,
      driverA: request.a.driver,
      lapA: request.a.lap,
      driverB: request.b.driver,
      lapB: request.b.lap,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!cancelled) setBattleState({ status: 'loading', progress })
      },
    })
      .then((battle) => {
        if (cancelled) return
        setBattleState({ status: 'ready', battle })
        currentRef.current = 0
        setCurrent(0)
        setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      })
      .catch((cause: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setBattleState({ status: 'error', message: messageFor(cause) })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [readySession, request, battleAttempt])

  const battle = battleState.status === 'ready' ? battleState.battle : null
  const duration = battle ? battleDuration(battle.a.lap, battle.b.lap) : 0

  const seek = useCallback(
    (value: number) => {
      const next = Math.min(Math.max(value, 0), duration)
      currentRef.current = next
      setCurrent(next)
    },
    [duration],
  )

  const toggle = useCallback(() => {
    if (!battle) return
    if (!playing && currentRef.current >= duration) seek(0)
    setPlaying((value) => !value)
  }, [battle, duration, playing, seek])

  useEffect(() => {
    if (!playing || !battle) return

    let frame = 0
    let last = performance.now()

    const tick = (now: number) => {
      const elapsed = Math.min(now - last, 250)
      last = now

      const next = Math.min(duration, currentRef.current + elapsed * speed)
      currentRef.current = next
      setCurrent(next)

      if (next >= duration) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, battle, speed, duration])

  useEffect(() => {
    if (!battle) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, button, select, textarea, a')) return

      if (event.key === ' ') {
        event.preventDefault()
        toggle()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seek(Math.max(0, currentRef.current - ARROW_STEP))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seek(Math.min(duration, currentRef.current + ARROW_STEP))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [battle, duration, seek, toggle])

  const chooseDriver = useCallback(
    (side: 'a' | 'b', number: number) => {
      if (!readySession) return
      const best = fastestLap(readySession.laps.get(number) ?? [])
      if (!best) return

      const pick = { driver: number, lap: best.lapNumber }
      if (side === 'a') setPickA(pick)
      else setPickB(pick)
    },
    [readySession],
  )

  const chooseLap = useCallback((side: 'a' | 'b', lap: number) => {
    if (side === 'a') setPickA((previous) => (previous ? { ...previous, lap } : previous))
    else setPickB((previous) => (previous ? { ...previous, lap } : previous))
  }, [])

  const startBattle = () => {
    if (!pickA || !pickB) return
    setBattleAttempt(0)
    setBattleState({ status: 'loading', progress: INITIAL_BATTLE_PROGRESS })
    setRequest({ a: pickA, b: pickB })
  }

  const retryBattle = () => {
    setBattleState({ status: 'loading', progress: INITIAL_BATTLE_PROGRESS })
    setBattleAttempt((value) => value + 1)
  }

  const changeDrivers = () => {
    setPlaying(false)
    setRequest(null)
    setBattleState({ status: 'idle' })
  }

  const pairing = (() => {
    if (!readySession || !pickA || !pickB) return null
    const sideA = readySession.drivers.find((driver) => driver.number === pickA.driver)
    const sideB = readySession.drivers.find((driver) => driver.number === pickB.driver)
    return sideA && sideB ? `${sideA.acronym} vs ${sideB.acronym}` : null
  })()

  const retrySession = () => {
    setRequest(null)
    setBattleState({ status: 'idle' })
    setSessionState({ status: 'loading', progress: INITIAL_SESSION_PROGRESS })
    setSessionAttempt((value) => value + 1)
  }

  return (
    <Modal label={`Qualifying battle — ${race.raceName}`} size="wide" onClose={onClose}>
      <div className="battle">
        {sessionState.status === 'loading' && (
          <BattleLoading progress={sessionState.progress} />
        )}

        {sessionState.status === 'error' && (
          <div className="battle__error">
            <ErrorState message={sessionState.message} onRetry={retrySession} />
          </div>
        )}

        {sessionState.status === 'ready' && (
          <>
            <BattleHeader
              race={race}
              session={sessionState.session}
              battle={battle}
              pairing={battleState.status === 'loading' ? pairing : null}
            />

            {battleState.status === 'idle' && (
              <BattleSetup
                session={sessionState.session}
                pickA={pickA}
                pickB={pickB}
                onDriver={chooseDriver}
                onLap={chooseLap}
                onStart={startBattle}
              />
            )}

            {battleState.status === 'loading' && (
              <BattleLoading progress={battleState.progress} />
            )}

            {battleState.status === 'error' && (
              <div className="battle__error">
                <ErrorState
                  message={battleState.message}
                  onRetry={retryBattle}
                />
                <button type="button" className="battle__change" onClick={changeDrivers}>
                  Change drivers
                </button>
              </div>
            )}

            {battleState.status === 'ready' && (
              <BattleView
                battle={battleState.battle}
                current={current}
                playing={playing}
                speed={speed}
                onToggle={toggle}
                onSeek={seek}
                onSpeed={setSpeed}
                onBack={changeDrivers}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function messageFor(cause: unknown): string {
  if (cause instanceof BattleUnavailableError) return cause.message
  if (cause instanceof Error) return cause.message
  return 'The battle could not be loaded.'
}

function BattleHeader({
  race,
  session,
  battle,
  pairing,
}: {
  race: Race
  session: BattleSession
  battle: QualifyingBattle | null
  pairing: string | null
}) {
  return (
    <header className="replay__head">
      <div>
        <p className="replay__kicker">
          {session.season} · {session.code === 'SQ' ? 'Sprint Qualifying' : 'Qualifying'} 1v1
        </p>
        <h2 className="replay__title">{race.raceName}</h2>
        <p className="replay__subtitle">
          {battle
            ? `${battle.a.driver.acronym} vs ${battle.b.driver.acronym} · Lap ${battle.a.lap.lapNumber} vs lap ${battle.b.lap.lapNumber}`
            : (pairing ?? 'Pick two drivers and one timed lap each.')}
        </p>
      </div>
      <span className="replay__source">OpenF1</span>
    </header>
  )
}

function BattleLoading({ progress }: { progress: BattleProgress }) {
  return (
    <div className="battle__loading replay__loading">
      <Loading message={progress.label} />
      {progress.total > 1 && (
        <progress className="replay__progress" value={progress.loaded} max={progress.total} />
      )}
      <p className="battle__hint">
        The first battle downloads two telemetry and two location feeds for the selected laps.
        Later battles are cached.
      </p>
    </div>
  )
}

function BattleSetup({
  session,
  pickA,
  pickB,
  onDriver,
  onLap,
  onStart,
}: {
  session: BattleSession
  pickA: Pick | null
  pickB: Pick | null
  onDriver: (side: 'a' | 'b', number: number) => void
  onLap: (side: 'a' | 'b', lap: number) => void
  onStart: () => void
}) {
  return (
    <div className="battle__setup">
      <div className="battle__slots">
        <SetupSlot
          side="a"
          label="Driver A"
          session={session}
          pick={pickA}
          otherDriver={pickB?.driver}
          onDriver={onDriver}
          onLap={onLap}
        />
        <div className="battle__vs" aria-hidden="true">
          VS
        </div>
        <SetupSlot
          side="b"
          label="Driver B"
          session={session}
          pick={pickB}
          otherDriver={pickA?.driver}
          onDriver={onDriver}
          onLap={onLap}
        />
      </div>

      <div className="battle__setup-actions">
        <button
          type="button"
          className="button battle__start"
          disabled={!pickA || !pickB}
          onClick={onStart}
        >
          Start battle
        </button>
        <p className="battle__hint">
          Both laps are normalised to the start line. Lap starts are approximate; the sector
          splits are exact.
        </p>
      </div>
    </div>
  )
}

function SetupSlot({
  side,
  label,
  session,
  pick,
  otherDriver,
  onDriver,
  onLap,
}: {
  side: 'a' | 'b'
  label: string
  session: BattleSession
  pick: Pick | null
  otherDriver: number | undefined
  onDriver: (side: 'a' | 'b', number: number) => void
  onLap: (side: 'a' | 'b', lap: number) => void
}) {
  const laps = pick ? (session.laps.get(pick.driver) ?? []) : []
  const fastest = fastestLap(laps)
  const driver = session.drivers.find((item) => item.number === pick?.driver) ?? null

  return (
    <section className="battle__slot">
      <p className="battle__slot-label">{label}</p>

      <label className="battle__field">
        <span>Driver</span>
        <select
          value={pick ? String(pick.driver) : ''}
          onChange={(event) => onDriver(side, Number(event.target.value))}
        >
          <option value="" disabled>
            Choose a driver
          </option>
          {session.ranked.map((item) => (
            <option key={item.number} value={item.number} disabled={item.number === otherDriver}>
              {item.acronym} · {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className="battle__field">
        <span>Lap</span>
        <select
          value={pick ? String(pick.lap) : ''}
          disabled={!pick}
          onChange={(event) => onLap(side, Number(event.target.value))}
        >
          <option value="" disabled>
            Choose a lap
          </option>
          {laps.map((lap) => (
            <option key={lap.lapNumber} value={lap.lapNumber}>
              Lap {lap.lapNumber} · {formatLapTime(lap.duration)}
              {lap.lapNumber === fastest?.lapNumber ? ' · fastest' : ''}
            </option>
          ))}
        </select>
      </label>

      {driver ? (
        <p className="battle__slot-team">
          <span className="battle__team-dot" style={{ background: driver.color }} />
          {driver.team}
        </p>
      ) : null}
    </section>
  )
}

function BattleView({
  battle,
  current,
  playing,
  speed,
  onToggle,
  onSeek,
  onSpeed,
  onBack,
}: {
  battle: QualifyingBattle
  current: number
  playing: boolean
  speed: number
  onToggle: () => void
  onSeek: (value: number) => void
  onSpeed: (value: number) => void
  onBack: () => void
}) {
  const state = battleStateAt(battle.a.lap, battle.b.lap, current)
  const end = battleDuration(battle.a.lap, battle.b.lap)
  const overallDelta = lapDelta(battle.a.lap, battle.b.lap)
  const leader =
    state.lead === 'a' ? battle.a.driver : state.lead === 'b' ? battle.b.driver : null

  return (
    <>
      <div className="battle__score">
        <ScoreSide side={battle.a} leading={state.lead === 'a'} />
        <div className="battle__delta">
          <span className="battle__delta-label">Live gap</span>
          <strong>
            {leader ? `${leader.acronym} +${formatBattleGap(state.gap)}` : 'Level'}
          </strong>
          <span className="battle__delta-sub">
            lap delta A−B {formatBattleDelta(overallDelta)}
          </span>
        </div>
        <ScoreSide side={battle.b} leading={state.lead === 'b'} />
      </div>

      <div className="battle__stage">
        <BattleTrack battle={battle} current={current} />

        <div className="battle__cockpits">
          <BattleCockpit
            driver={battle.a.driver}
            lap={battle.a.lap}
            telemetry={state.a}
            finished={current >= battle.a.lap.duration}
            leading={state.lead === 'a'}
          />
          <BattleCockpit
            driver={battle.b.driver}
            lap={battle.b.lap}
            telemetry={state.b}
            finished={current >= battle.b.lap.duration}
            leading={state.lead === 'b'}
          />
        </div>

        <SectorTable a={battle.a} b={battle.b} />
      </div>

      <BattleControls
        duration={end}
        current={current}
        playing={playing}
        speed={speed}
        onToggle={onToggle}
        onSeek={onSeek}
        onSpeed={onSpeed}
        onBack={onBack}
      />

      <p className="battle__hint battle__foot">
        Space plays and pauses · ←/→ scrubs one second · the live gap is estimated at the
        same point on track
      </p>
    </>
  )
}

function ScoreSide({ side, leading }: { side: BattleSide; leading: boolean }) {
  return (
    <div className="battle__score-side" data-leading={leading || undefined}>
      <span className="battle__score-dot" style={{ background: side.driver.color }} />
      <div className="battle__score-id">
        <p className="battle__score-code">{side.driver.acronym}</p>
        <p className="battle__score-team">{side.driver.team}</p>
      </div>
      <strong className="battle__score-time">{formatLapTime(side.lap.duration)}</strong>
    </div>
  )
}

function SectorTable({ a, b }: { a: BattleSide; b: BattleSide }) {
  const sectorsA = a.lap.sectors
  const sectorsB = b.lap.sectors
  const deltas = sectorDeltas(a.lap, b.lap)
  const labels = ['S1', 'S2', 'S3'] as const

  return (
    <table className="battle__sectors">
      <caption className="sr-only">
        Sector times for {a.driver.acronym} and {b.driver.acronym}
      </caption>
      <thead>
        <tr>
          <th scope="col">Split</th>
          <th scope="col">{a.driver.acronym}</th>
          <th scope="col">{b.driver.acronym}</th>
          <th scope="col">Δ A−B</th>
        </tr>
      </thead>
      <tbody>
        {sectorsA && sectorsB ? (
          labels.map((label, index) => {
            const delta = deltas[index]
            const aFaster = sectorsA[index] < sectorsB[index] ? 'true' : undefined
            const bFaster = sectorsB[index] < sectorsA[index] ? 'true' : undefined
            return (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td data-fast={aFaster}>{formatLapTime(sectorsA[index])}</td>
                <td data-fast={bFaster}>{formatLapTime(sectorsB[index])}</td>
                <td className="battle__sector-delta">
                  {delta === null ? '—' : formatBattleDelta(delta)}
                </td>
              </tr>
            )
          })
        ) : (
          <tr>
            <td colSpan={4}>Sector times are not available for these laps.</td>
          </tr>
        )}
        <tr className="battle__sector-total">
          <th scope="row">Lap</th>
          <td data-fast={a.lap.duration < b.lap.duration ? 'true' : undefined}>
            {formatLapTime(a.lap.duration)}
          </td>
          <td data-fast={b.lap.duration < a.lap.duration ? 'true' : undefined}>
            {formatLapTime(b.lap.duration)}
          </td>
          <td className="battle__sector-delta">
            {formatBattleDelta(lapDelta(a.lap, b.lap))}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

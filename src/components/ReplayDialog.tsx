import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorState, Loading } from './Feedback'
import { Modal } from './Modal'
import { ReplayControls } from './ReplayControls'
import { ReplayLeaderboard } from './ReplayLeaderboard'
import { ReplayMap } from './ReplayMap'
import type { Race, SessionCode } from '../api/types'
import type { ReplayData } from '../lib/replay'
import { ReplayUnavailableError, loadReplay } from '../lib/replaySource'
import type { ReplayProgress } from '../lib/replaySource'

interface ReplayDialogProps {
  race: Race
  code: SessionCode
  onClose: () => void
}

type LoadState =
  | { status: 'loading'; progress: ReplayProgress }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ReplayData }

const INITIAL_PROGRESS: ReplayProgress = {
  phase: 'session',
  label: 'Finding the session…',
  loaded: 0,
  total: 1,
}

const DEFAULT_SPEED = 4
const ARROW_STEP = 10_000
const NO_DRIVERS: ReadonlySet<number> = new Set()

/**
 * The replay popup: loads one session, then owns the playhead and the
 * transport. The map and tower are pure views of that playhead.
 */
export function ReplayDialog({ race, code, onClose }: ReplayDialogProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading', progress: INITIAL_PROGRESS })
  const [attempt, setAttempt] = useState(0)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  // Empty means every car is visible. A non-empty set narrows the circuit to
  // the selected drivers so the director can isolate a battle.
  const [selectedDrivers, setSelectedDrivers] = useState<ReadonlySet<number>>(NO_DRIVERS)

  // The animation loop reads and writes the playhead every frame. Keeping it in
  // a ref as well as state means the loop never has to restart on each frame.
  const currentRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    loadReplay({
      race,
      code,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!cancelled) setState({ status: 'loading', progress })
      },
    })
      .then((data) => {
        if (cancelled) return
        currentRef.current = data.start
        setCurrent(data.start)
        setSelectedDrivers(NO_DRIVERS)
        setState({ status: 'ready', data })
      })
      .catch((cause: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setState({
          status: 'error',
          message:
            cause instanceof ReplayUnavailableError
              ? cause.message
              : cause instanceof Error
                ? cause.message
                : 'The replay could not be loaded.',
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [race, code, attempt])

  const seek = useCallback((value: number) => {
    currentRef.current = value
    setCurrent(value)
  }, [])

  const toggleDriver = useCallback((number: number) => {
    setSelectedDrivers((previous) => {
      const next = new Set(previous)
      if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })
  }, [])

  const resetDriverFilter = useCallback(() => setSelectedDrivers(NO_DRIVERS), [])

  const data = state.status === 'ready' ? state.data : null

  const toggle = useCallback(() => {
    if (!data) return
    if (!playing && currentRef.current >= data.end) seek(data.start)
    setPlaying((value) => !value)
  }, [data, playing, seek])

  // Advance the playhead by however much real time passed, scaled by the speed.
  // A backgrounded tab can return one huge delta; clamp it so the replay does
  // not jump to the flag when the visitor comes back.
  useEffect(() => {
    if (!playing || !data) return

    let frame = 0
    let last = performance.now()

    const tick = (now: number) => {
      const elapsed = Math.min(now - last, 250)
      last = now

      const next = Math.min(data.end, currentRef.current + elapsed * speed)
      currentRef.current = next
      setCurrent(next)

      if (next >= data.end) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, data])

  // Space and the arrows work wherever focus is in the dialog, except on a
  // control that already uses them (the scrubber, buttons, links).
  useEffect(() => {
    if (!data) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, button, select, textarea, a')) return

      if (event.key === ' ') {
        event.preventDefault()
        toggle()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seek(Math.max(data.start, currentRef.current - ARROW_STEP))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seek(Math.min(data.end, currentRef.current + ARROW_STEP))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [data, seek, toggle])

  return (
    <Modal label={`Replay — ${race.raceName}`} size="wide" onClose={onClose}>
      <div className="replay">
        {state.status === 'loading' && <ReplayLoading progress={state.progress} />}

        {state.status === 'error' && (
          <div className="replay__error">
            <ErrorState
              message={state.message}
              onRetry={() => {
                setState({ status: 'loading', progress: INITIAL_PROGRESS })
                setAttempt((value) => value + 1)
              }}
            />
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <header className="replay__head">
              <div>
                <p className="replay__kicker">
                  {race.season} · {code === 'SR' ? 'Sprint' : 'Race'} replay
                </p>
                <h2 className="replay__title">{state.data.title}</h2>
                <p className="replay__subtitle">{state.data.subtitle}</p>
              </div>
              <span className="replay__source">
                {state.data.source === 'baked' ? 'Pre-baked' : 'OpenF1'}
              </span>
            </header>

            {state.data.missing ? (
              <p className="replay__note">
                {state.data.missing} car{state.data.missing === 1 ? '' : 's'} could not be loaded;
                the replay plays with the rest of the field.
              </p>
            ) : null}

            <div className="replay__layout">
              <ReplayMap data={state.data} current={current} selected={selectedDrivers} />
              <ReplayLeaderboard
                data={state.data}
                current={current}
                selected={selectedDrivers}
                onToggleDriver={toggleDriver}
                onResetFilter={resetDriverFilter}
              />
            </div>

            <ReplayControls
              start={state.data.start}
              end={state.data.end}
              current={current}
              playing={playing}
              speed={speed}
              onToggle={toggle}
              onSeek={seek}
              onSpeed={setSpeed}
            />

            <p className="replay__hint">
              Space plays and pauses · ←/→ scrubs 10 seconds · click a driver to filter the
              track · position, not gaps
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

function ReplayLoading({ progress }: { progress: ReplayProgress }) {
  const showProgress = progress.total > 1
  return (
    <div className="replay__loading">
      <Loading message={progress.label} />
      {showProgress && (
        <progress className="replay__progress" value={progress.loaded} max={progress.total} />
      )}
      {progress.phase === 'locations' && (
        <p className="replay__hint">
          The first replay of an unbaked race downloads one feed per car from OpenF1. It is cached
          afterwards.
        </p>
      )}
    </div>
  )
}

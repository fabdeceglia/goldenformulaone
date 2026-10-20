import { formatReplayClock } from '../lib/replay'

interface ReplayControlsProps {
  start: number
  end: number
  current: number
  playing: boolean
  speed: number
  lap: number | null
  totalLaps?: number
  onToggle: () => void
  onSeek: (value: number) => void
  onSpeed: (value: number) => void
}

const SPEEDS = [1, 2, 4, 8] as const

/**
 * Transport bar: play/pause, scrubber, elapsed time and the speed selector.
 * Keyboard shortcuts live on the dialog, so they work wherever focus is.
 */
export function ReplayControls({
  start,
  end,
  current,
  playing,
  speed,
  lap,
  totalLaps,
  onToggle,
  onSeek,
  onSpeed,
}: ReplayControlsProps) {
  return (
    <div className="replay__transport">
      <button type="button" className="replay__play" onClick={onToggle}>
        {playing ? 'Pause' : 'Play'}
      </button>

      <label className="replay__scrubber-wrap">
        <span className="sr-only">Replay position</span>
        <input
          className="replay__scrubber"
          type="range"
          min={start}
          max={end}
          step={100}
          value={Math.min(Math.max(current, start), end)}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>

      <span className="replay__time">
        {lap !== null && totalLaps ? (
          <span className="replay__lap" aria-label={`Lap ${lap} of ${totalLaps}`}>
            Lap {lap} / {totalLaps}
          </span>
        ) : null}
        <span className="replay__clock">
          {formatReplayClock(current - start)} / {formatReplayClock(end - start)}
        </span>
      </span>

      <div className="replay__speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            className="replay__speed"
            aria-pressed={value === speed}
            onClick={() => onSpeed(value)}
          >
            {value}×
          </button>
        ))}
      </div>
    </div>
  )
}

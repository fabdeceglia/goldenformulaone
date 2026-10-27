import { formatLapTime } from '../lib/replay'

interface BattleControlsProps {
  duration: number
  current: number
  playing: boolean
  speed: number
  onToggle: () => void
  onSeek: (value: number) => void
  onSpeed: (value: number) => void
  /** Back to the driver picker; the button is only rendered when provided. */
  onBack?: () => void
}

const SPEEDS = [0.5, 1, 2, 4] as const

/**
 * The battle transport uses the replay's control styling but a lap-length range
 * and slower speeds: a qualifying lap is watched, not skimmed at 16×.
 */
export function BattleControls({
  duration,
  current,
  playing,
  speed,
  onToggle,
  onSeek,
  onSpeed,
  onBack,
}: BattleControlsProps) {
  return (
    <div className="replay__transport battle__transport">
      <button type="button" className="replay__play" onClick={onToggle}>
        {playing ? 'Pause' : 'Play'}
      </button>

      <label className="replay__scrubber-wrap">
        <span className="sr-only">Battle position</span>
        <input
          className="replay__scrubber"
          type="range"
          min={0}
          max={duration}
          step={50}
          value={Math.min(Math.max(current, 0), duration)}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>

      <span className="replay__time">
        <span className="replay__clock">
          {formatLapTime(current)} / {formatLapTime(duration)}
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

      {onBack && (
        <button type="button" className="battle__change battle__change--transport" onClick={onBack}>
          Change drivers
        </button>
      )}
    </div>
  )
}

interface SeasonStatsNavProps {
  /** One-based position in the standings list. */
  position: number
  total: number
  /** Noun for the accessible labels, e.g. "driver" or "team". */
  noun: string
  onPrevious: () => void
  onNext: () => void
}

/**
 * Previous/next controls for the season dialog. The caller owns the selection,
 * so the same arrows can wrap around the standings list without this component
 * knowing how the list is fetched.
 */
export function SeasonStatsNav({ position, total, noun, onPrevious, onNext }: SeasonStatsNavProps) {
  return (
    <div className="stats__nav">
      <button
        type="button"
        className="stats__nav-button"
        aria-label={`Previous ${noun}`}
        onClick={onPrevious}
      >
        <Chevron direction="left" />
      </button>
      <span className="stats__nav-count" aria-live="polite" aria-atomic="true">
        {position} / {total}
      </span>
      <button
        type="button"
        className="stats__nav-button"
        aria-label={`Next ${noun}`}
        onClick={onNext}
      >
        <Chevron direction="right" />
      </button>
    </div>
  )
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}

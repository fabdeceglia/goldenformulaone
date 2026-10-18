import { formatCompactDate, formatDateRange, formatTime } from '../lib/format'
import { raceSchedule } from '../lib/schedule'
import type { EventStatus, FeaturedEvent } from '../lib/schedule'

const BADGE: Record<EventStatus, string> = {
  raceDay: 'Race day',
  live: 'Race weekend',
  upcoming: 'Next up',
  final: 'Season finale',
}

function isRunning(status: EventStatus): boolean {
  return status === 'live' || status === 'raceDay'
}

function countdownLabel(days: number): string {
  if (days <= 0) return 'Starts today'
  if (days === 1) return 'Starts tomorrow'
  return `Starts in ${days} days`
}

/**
 * Full-width panel used on the home screen. Round-specific badges only make
 * sense for the feature itself, so a panel opened for any other round can drop
 * them and leave just the countdown.
 */
export function FeaturedEventPanel({
  featured,
  showBadge = true,
  onOpenCircuitInfo,
}: {
  featured: FeaturedEvent
  showBadge?: boolean
  /**
   * When given, the panel offers the circuit's info popup. Home passes it; the
   * schedule's details popup does not, since that row already has its own Info.
   */
  onOpenCircuitInfo?: () => void
}) {
  const { race, status, daysUntilStart } = featured
  const schedule = raceSchedule(race)
  const circuit = race.Circuit

  return (
    <section className={`hero hero--${status}`} aria-labelledby="featured-event">
      <div className="hero__main">
        <div className="hero__top">
          {showBadge && (
            <span className={`pill pill--${status}`}>
              {isRunning(status) && <span className="pill__dot" aria-hidden="true" />}
              {BADGE[status]}
            </span>
          )}
          {status === 'upcoming' && (
            <span className="hero__countdown">{countdownLabel(daysUntilStart)}</span>
          )}
          {status === 'final' && <span className="hero__countdown">Season complete</span>}
        </div>

        <h2 className="hero__title" id="featured-event">
          {race.raceName}
        </h2>

        <p className="hero__meta">
          Round {race.round} · {circuit.circuitName}
        </p>
        <p className="hero__meta hero__meta--muted">
          {circuit.Location.locality}, {circuit.Location.country}
        </p>

        {/* The weekend schedule already carries the dates and the race time, so
            the left column spends that space on the way into the circuit. */}
        {onOpenCircuitInfo && (
          <button
            type="button"
            className="button button--ghost hero__info"
            onClick={onOpenCircuitInfo}
            aria-label={`${circuit.circuitName} information`}
          >
            Circuit info
          </button>
        )}
      </div>

      <div className="hero__schedule">
        <h3 className="hero__schedule-title">Weekend schedule</h3>
        <ul className="schedule">
          {schedule.map((entry) => (
            <li
              key={entry.key}
              className={`schedule__row${entry.isRace ? ' schedule__row--race' : ''}`}
            >
              <span className="schedule__label">{entry.label}</span>
              <span className="schedule__when">
                <span className="schedule__day">{formatCompactDate(entry.date, entry.time)}</span>
                {entry.time && (
                  <span className="schedule__clock">{formatTime(entry.date, entry.time)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

interface FeaturedEventBarProps {
  featured: FeaturedEvent
  onOpen: () => void
}

/** One-line version shown at the top of every non-home section. */
export function FeaturedEventBar({ featured, onOpen }: FeaturedEventBarProps) {
  const { race, status, start, end, daysUntilStart } = featured

  return (
    <button
      type="button"
      className={`event-bar event-bar--${status}`}
      onClick={onOpen}
      aria-label={`${BADGE[status]}: ${race.raceName}. Open the featured event.`}
    >
      <span className={`pill pill--${status}`}>
        {isRunning(status) && <span className="pill__dot" aria-hidden="true" />}
        {BADGE[status]}
      </span>

      <span className="event-bar__name">{race.raceName}</span>

      <span className="event-bar__meta">
        Round {race.round} · {race.Circuit.Location.locality}, {race.Circuit.Location.country}
      </span>

      <span className="event-bar__when">{formatDateRange(start, end)}</span>

      {status === 'upcoming' && (
        <span className="event-bar__cta">{countdownLabel(daysUntilStart)}</span>
      )}

      <span className="event-bar__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

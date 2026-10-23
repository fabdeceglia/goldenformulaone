import type { SessionCode } from '../api/types'
import { useNow } from '../hooks/useNow'
import { formatCompactDate, formatDateRange, formatTime } from '../lib/format'
import { raceSchedule, sessionPhase, weekendProgress } from '../lib/schedule'
import type { EventStatus, FeaturedEvent } from '../lib/schedule'

const BADGE: Record<EventStatus, string> = {
  raceDay: 'Race day',
  live: 'Race weekend',
  upcoming: 'Next up',
  final: 'Season finale',
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
  onOpenSession,
}: {
  featured: FeaturedEvent
  showBadge?: boolean
  /**
   * When given, the panel offers the circuit's info popup. Home passes it; the
   * schedule's details popup does not, since that row already has its own Info.
   */
  onOpenCircuitInfo?: () => void
  /**
   * When given, the panel offers the way into a session once that session has
   * finished. Only the home hero passes it — a round opened from the schedule
   * has its own results action on the row.
   */
  onOpenSession?: (session: SessionCode) => void
}) {
  const { race, status, daysUntilStart } = featured
  const now = useNow()
  const schedule = raceSchedule(race)
  const circuit = race.Circuit

  const { live, finished } = weekendProgress(race, now)

  // Only set the right-hand finished column aside once a session has actually
  // finished; before then the schedule is just names and dates, and reserving
  // the space would leave a dead gap on every row.
  const showFinishedColumn =
    onOpenSession !== undefined &&
    schedule.some((entry) => sessionPhase(entry, now) === 'finished')

  // A session on track outranks the weekend label: "Live · Qualifying" beats a
  // generic "Race weekend", and the badge goes red to match. Once the race
  // itself is done, "Race complete" says so rather than leaving "Race day" up.
  const badgeStatus: EventStatus = live ? 'live' : status
  const raceComplete = !live && status === 'raceDay' && finished?.isRace === true
  const badgeLabel = live
    ? `Live · ${live.label}`
    : raceComplete
      ? 'Race complete'
      : BADGE[status]

  return (
    <section className={`hero hero--${status}`} aria-labelledby="featured-event">
      <div className="hero__main">
        <div className="hero__top">
          {showBadge && (
            <span className={`pill pill--${badgeStatus}`}>
              {live && <span className="pill__dot" aria-hidden="true" />}
              {badgeLabel}
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
            the left column keeps just the way into the circuit; results live on
            each finished session in the schedule, next to its name. */}
        {onOpenCircuitInfo && (
          <div className="hero__actions">
            <button
              type="button"
              className="button button--ghost hero__info"
              onClick={onOpenCircuitInfo}
              aria-label={`${circuit.circuitName} information`}
            >
              Circuit info
            </button>
          </div>
        )}
      </div>

      <div className="hero__schedule">
        <h3 className="hero__schedule-title">Weekend schedule</h3>
        <ul className="schedule">
          {schedule.map((entry) => {
            const isLive = entry.key === live?.key
            const isFinished = sessionPhase(entry, now) === 'finished'
            return (
              <li
                key={entry.key}
                className={`schedule__row${entry.isRace ? ' schedule__row--race' : ''}${
                  isLive ? ' schedule__row--live' : ''
                }`}
              >
                <span className="schedule__label">
                  {isLive && <span className="schedule__dot" aria-hidden="true" />}
                  {entry.label}
                </span>
                <span className="schedule__when">
                  <span className="schedule__day">{formatCompactDate(entry.date, entry.time)}</span>
                  {entry.time && (
                    <span className="schedule__clock">{formatTime(entry.date, entry.time)}</span>
                  )}
                </span>
                {/* A finished session is a status, not a promise that its
                    classification has arrived; the chip still opens the
                    session so whatever is available can be shown. */}
                {showFinishedColumn && (
                  <span className="schedule__action">
                    {isFinished && onOpenSession && (
                      <button
                        type="button"
                        className="schedule__finished"
                        onClick={() => onOpenSession(entry.code)}
                        aria-label={`Open ${entry.label}`}
                      >
                        Finished
                      </button>
                    )}
                  </span>
                )}
              </li>
            )
          })}
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
  const now = useNow()
  const { live, finished } = weekendProgress(race, now)

  const badgeStatus: EventStatus = live ? 'live' : status
  const raceComplete = !live && status === 'raceDay' && finished?.isRace === true
  const badgeLabel = live
    ? `Live · ${live.label}`
    : raceComplete
      ? 'Race complete'
      : BADGE[status]

  return (
    <button
      type="button"
      className={`event-bar event-bar--${status}`}
      onClick={onOpen}
      aria-label={`${badgeLabel}: ${race.raceName}. Open the featured event.`}
    >
      <span className={`pill pill--${badgeStatus}`}>
        {live && <span className="pill__dot" aria-hidden="true" />}
        {badgeLabel}
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

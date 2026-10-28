import type { Race, SessionCode } from '../api/types'
import {
  SESSION_MINUTES,
  raceSchedule,
  sessionStart as startOf,
} from '../shared/schedule'
import type { ScheduleEntry } from '../shared/schedule'
import { clockNow } from './clock'
import { parseUtcInstant, toDateKey } from './format'

export { raceSchedule }
export type { ScheduleEntry }

const LOADED_AT = new Date(clockNow())

/**
 * Captured once at module load. Keeping it out of the render path avoids
 * impure calls during render and is plenty for a browsing session.
 *
 * This is the *visitor's* calendar day, matching how times are rendered: a
 * session late on Sunday UTC can already be Monday where they are, and the
 * featured-event logic has to agree with what they see.
 */
export const TODAY = toDateKey(LOADED_AT)

/** Timestamp of module load, for ordering sessions that share a date. */
export const NOW_MILLIS = LOADED_AT.getTime()

/**
 * The window a race weekend occupies: from the first session to race day, as
 * calendar days in the visitor's timezone.
 * `2026-10-23` -> `2026-10-25` for the United States Grand Prix.
 */
export function eventWindow(race: Race): { start: string; end: string } {
  const dates = raceSchedule(race)
    .map(sessionDayKey)
    .sort()
  return { start: dates[0], end: dates[dates.length - 1] }
}

/**
 * The day a session lands on locally. Sessions carry a time, so they shift;
 * anything without one is already a calendar day and is taken as written.
 */
function sessionDayKey(entry: ScheduleEntry): string {
  const instant = parseUtcInstant(entry.date, entry.time)
  return instant ? toDateKey(instant) : entry.date
}

/** Race day in the visitor's timezone, matching how the calendar renders it. */
export function raceDayKey(race: Race): string {
  const instant = parseUtcInstant(race.date, race.time)
  return instant ? toDateKey(instant) : race.date
}

export type EventStatus = 'raceDay' | 'live' | 'upcoming' | 'final'

export interface FeaturedEvent {
  race: Race
  status: EventStatus
  /** First day of the race weekend. */
  start: string
  /** Race day. */
  end: string
  /** Whole days until the weekend starts; only meaningful when `upcoming`. */
  daysUntilStart: number
}

/**
 * Describes any round the way the featured panel presents it, from the weekend
 * window alone. Used both to pick the event to feature and to open a round
 * still to come straight from the calendar.
 */
export function eventFor(race: Race, today: string = TODAY): FeaturedEvent {
  const window = eventWindow(race)

  if (window.start <= today && today <= window.end) {
    return {
      race,
      ...window,
      status: raceDayKey(race) === today ? 'raceDay' : 'live',
      daysUntilStart: 0,
    }
  }

  if (window.start > today) {
    return { race, ...window, status: 'upcoming', daysUntilStart: daysBetween(today, window.start) }
  }

  return { race, ...window, status: 'final', daysUntilStart: 0 }
}

/**
 * Picks the event to feature: the one happening right now if today falls inside
 * a race weekend, otherwise the next one on the calendar. Once a season is over
 * it falls back to the final round so the layout stays consistent.
 */
export function findFeaturedEvent(races: Race[], today: string = TODAY): FeaturedEvent | null {
  if (races.length === 0) return null

  const events = races.map((race) => eventFor(race, today))

  return (
    events.find((event) => event.status === 'live' || event.status === 'raceDay') ??
    events.find((event) => event.status === 'upcoming') ??
    events[events.length - 1]
  )
}

function daysBetween(from: string, to: string): number {
  const millis = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(millis / 86_400_000)
}

/* ---------- Weekend progress ---------- */

export type SessionPhase = 'upcoming' | 'live' | 'finished'

/** Estimated end of a session, in epoch milliseconds. */
function sessionEnd(entry: ScheduleEntry): number {
  return sessionStart(entry) + SESSION_MINUTES[entry.code] * 60_000
}

/**
 * Where one session sits relative to the clock. Durations are estimates (see
 * `SESSION_MINUTES`), so a session only stops counting as live once it is
 * comfortably over.
 */
export function sessionPhase(entry: ScheduleEntry, now: number = Date.now()): SessionPhase {
  const start = sessionStart(entry)
  if (!Number.isFinite(start)) return 'upcoming'

  const end = sessionEnd(entry)
  if (now < start) return 'upcoming'
  if (now < end) return 'live'
  return 'finished'
}

export interface WeekendProgress {
  /** The session on track right now, if the clock falls inside one. */
  live: ScheduleEntry | null
  /** The most recently finished session, if any. */
  finished: ScheduleEntry | null
}

/**
 * Where a weekend stands judged by the clock rather than the calendar day: which
 * session is on track and which one just ended.
 */
export function weekendProgress(race: Race, now: number = Date.now()): WeekendProgress {
  let live: ScheduleEntry | null = null
  let finished: ScheduleEntry | null = null

  // Sessions come back in running order, so the last one that has ended wins.
  for (const entry of raceSchedule(race)) {
    const phase = sessionPhase(entry, now)
    if (phase === 'live') live = entry
    else if (phase === 'finished') finished = entry
  }

  return { live, finished }
}

/* ---------- Session results ---------- */

/**
 * The most recent session that has already started, used as the default when
 * opening a round. Falls back to the race for rounds still to come.
 */
export function defaultSession(race: Race | undefined, now: number = NOW_MILLIS): SessionCode {
  if (!race) return 'R'

  let latest: SessionCode = 'R'
  for (const entry of raceSchedule(race)) {
    if (sessionStart(entry) <= now) {
      latest = entry.code
    }
  }

  return latest
}

function sessionStart(entry: ScheduleEntry): number {
  return startOf(entry.date, entry.time)
}

import type { Race, SessionCode } from '../api/types'
import { clockNow } from './clock'
import { parseUtcInstant, toDateKey } from './format'

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

const SESSION_KEYS = [
  'FirstPractice',
  'SecondPractice',
  'ThirdPractice',
  'SprintQualifying',
  'Sprint',
  'Qualifying',
] as const satisfies readonly (keyof Race)[]

const SESSION_KEY_LABELS: Record<(typeof SESSION_KEYS)[number], string> = {
  FirstPractice: 'Practice 1',
  SecondPractice: 'Practice 2',
  ThirdPractice: 'Practice 3',
  SprintQualifying: 'Sprint qualifying',
  Sprint: 'Sprint',
  Qualifying: 'Qualifying',
}

/**
 * How the Ergast race schedule maps onto the codes the alpha results endpoint
 * accepts. Sprint weekends replace FP2/FP3 with sprint qualifying and the
 * sprint, which is why this is a mapping rather than a positional list.
 */
const SESSION_CODE_BY_KEY: Record<(typeof SESSION_KEYS)[number] | 'race', SessionCode> = {
  FirstPractice: 'FP1',
  SecondPractice: 'FP2',
  ThirdPractice: 'FP3',
  SprintQualifying: 'SQ',
  Sprint: 'SR',
  Qualifying: 'Q',
  race: 'R',
}

export interface ScheduleEntry {
  key: string
  label: string
  code: SessionCode
  date: string
  time?: string
  isRace?: boolean
}

/**
 * Longest a session can plausibly run before it is treated as over, in minutes.
 * Deliberately generous: a red flag or a safety car can stretch one well past
 * its scheduled slot, and the live marker should only clear once the session is
 * genuinely done. The race is the one that can really run long, so it gets the
 * widest allowance.
 */
const SESSION_MINUTES: Record<SessionCode, number> = {
  FP1: 60,
  FP2: 60,
  FP3: 60,
  SQ: 30,
  SR: 45,
  Q: 60,
  R: 120,
}

/** Every session of a race weekend, including the race itself, in order. */
export function raceSchedule(race: Race): ScheduleEntry[] {
  const entries: ScheduleEntry[] = []

  for (const key of SESSION_KEYS) {
    const session = race[key]
    if (session) {
      entries.push({
        key,
        label: SESSION_KEY_LABELS[key],
        code: SESSION_CODE_BY_KEY[key],
        date: session.date,
        time: session.time,
      })
    }
  }

  entries.push({
    key: 'race',
    label: 'Race',
    code: 'R',
    date: race.date,
    time: race.time,
    isRace: true,
  })

  const stamp = (entry: ScheduleEntry) => `${entry.date}T${entry.time ?? '23:59:59Z'}`
  return entries.sort((a, b) => stamp(a).localeCompare(stamp(b)))
}

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

/**
 * How long the app keeps expecting results to appear after a session ends.
 * Generous enough to cover a race day and the following morning, but bounded so
 * browsing an old round does not turn the results view into a permanent poller.
 */
const RESULTS_WINDOW_MINUTES = 24 * 60

/**
 * Delay before the next background check for a session's results, or `null`
 * when the clock is outside the window where a result could plausibly arrive.
 *
 * The session is considered close enough to poll from ten minutes before its
 * estimated end (a red flag can finish one early). Checks are frequent around
 * the flag, then relax quickly so a tab left open on race day is cheap.
 */
export function resultsPollDelay(
  entry: ScheduleEntry,
  now: number = Date.now(),
): number | null {
  const end = sessionEnd(entry)
  if (!Number.isFinite(end)) return null

  const afterEnd = now - end
  if (afterEnd < -10 * 60_000) return null
  if (afterEnd < 15 * 60_000) return 30_000
  if (afterEnd < 60 * 60_000) return 60_000
  if (afterEnd < RESULTS_WINDOW_MINUTES * 60_000) return 5 * 60_000
  return null
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
  return Date.parse(`${entry.date}T${entry.time ?? '00:00:00Z'}`)
}

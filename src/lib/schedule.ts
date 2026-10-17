import type { Race, SessionCode } from '../api/types'

const LOADED_AT = new Date()

/**
 * Captured once at module load. Keeping it out of the render path avoids
 * impure calls during render and is plenty for a browsing session.
 */
export const TODAY = LOADED_AT.toISOString().slice(0, 10)

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
 * The window a race weekend occupies: from the first session to race day.
 * `2026-10-23` -> `2026-10-25` for the United States Grand Prix.
 */
export function eventWindow(race: Race): { start: string; end: string } {
  const dates = raceSchedule(race)
    .map((entry) => entry.date)
    .sort()
  return { start: dates[0], end: dates[dates.length - 1] }
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
 * Picks the event to feature: the one happening right now if today falls inside
 * a race weekend, otherwise the next one on the calendar. Once a season is over
 * it falls back to the final round so the layout stays consistent.
 */
export function findFeaturedEvent(races: Race[], today: string = TODAY): FeaturedEvent | null {
  if (races.length === 0) return null

  const windows = races.map((race) => ({ race, ...eventWindow(race) }))

  const current = windows.find((window) => window.start <= today && today <= window.end)
  if (current) {
    return {
      ...current,
      status: current.race.date === today ? 'raceDay' : 'live',
      daysUntilStart: 0,
    }
  }

  const next = windows.find((window) => window.start > today)
  if (next) {
    return { ...next, status: 'upcoming', daysUntilStart: daysBetween(today, next.start) }
  }

  const last = windows[windows.length - 1]
  return { ...last, status: 'final', daysUntilStart: 0 }
}

function daysBetween(from: string, to: string): number {
  const millis = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(millis / 86_400_000)
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

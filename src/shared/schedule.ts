import type { Race, SessionCode } from '../api/types'

/**
 * Pure session-window helpers shared by the browser and the results Worker.
 *
 * This module deliberately contains no clock, `window` or `import.meta.env`
 * access: the Worker bundles it, and all instants are UTC epoch milliseconds.
 */

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
 * its scheduled slot, and the results Worker should not fetch before the flag.
 */
export const SESSION_MINUTES: Record<SessionCode, number> = {
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

/** Parses one session's scheduled start as UTC epoch milliseconds. */
export function sessionStart(date: string, time?: string): number {
  return Date.parse(`${date}T${time ?? '00:00:00Z'}`)
}

/** Estimated end of a session, from its scheduled start. */
export function sessionEnd(start: number, code: SessionCode): number {
  return start + SESSION_MINUTES[code] * 60_000
}

export interface SessionWindow {
  entry: ScheduleEntry
  start: number
  end: number
}

/** Every session window of a weekend, ordered as the weekend runs. */
export function sessionWindows(race: Race): SessionWindow[] {
  return raceSchedule(race).map((entry) => {
    const start = sessionStart(entry.date, entry.time)
    return { entry, start, end: sessionEnd(start, entry.code) }
  })
}

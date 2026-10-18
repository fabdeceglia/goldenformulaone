/**
 * Everything the API sends is UTC, and the app renders it in the visitor's own
 * timezone. That means handling two different kinds of date:
 *
 *  - **instants** — a date *and* a time, which are shifted into local time;
 *  - **calendar days** — a date on its own, with no time to anchor it. These
 *    are printed exactly as written, because shifting a bare date would move a
 *    race to the wrong day for everyone west of UTC.
 */

/** Parses an API date/time pair, which is UTC, into a Date. */
export function parseUtcInstant(date: string | undefined, time: string | undefined): Date | null {
  if (!date || !time) return null
  // Times normally arrive as "13:00:00Z"; tolerate a missing zone marker.
  const stamped = /(?:Z|[+-]\d{2}:?\d{2})$/.test(time) ? `${date}T${time}` : `${date}T${time}Z`
  const parsed = new Date(stamped)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** The visitor's calendar day for an instant, as `YYYY-MM-DD`. */
export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/* ---------- Calendar days (no timezone shifting) ---------- */

const DAY = { timeZone: 'UTC' } as const

const dayFull = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  ...DAY,
})
const dayCompact = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  ...DAY,
})
const dayWeekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', ...DAY })
const dayNumber = new Intl.DateTimeFormat('en-GB', { day: '2-digit', ...DAY })
const dayYear = new Intl.DateTimeFormat('en-GB', { year: 'numeric', ...DAY })
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  ...DAY,
})

function parseCalendarDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/* ---------- Instants (visitor's timezone) ---------- */

const localDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const localCompact = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})
const localClock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** A date, localised when the API attached a time to it. */
export function formatDate(date: string | undefined, time?: string): string {
  if (!date) return '—'

  const instant = parseUtcInstant(date, time)
  if (instant) return localDate.format(instant)

  const day = parseCalendarDay(date)
  return Number.isNaN(day.getTime()) ? date : dayFull.format(day)
}

/** Compact day label, e.g. "Fri 23 Oct", localised when a time is attached. */
export function formatCompactDate(date: string | undefined, time?: string): string {
  if (!date) return '—'

  const instant = parseUtcInstant(date, time)
  if (instant) return localCompact.format(instant)

  const day = parseCalendarDay(date)
  return Number.isNaN(day.getTime()) ? date : dayCompact.format(day)
}

/** Clock time in the visitor's timezone, e.g. "14:00". */
export function formatTime(date: string | undefined, time: string | undefined): string {
  const instant = parseUtcInstant(date, time)
  return instant ? localClock.format(instant) : ''
}

export function formatDateTime(date: string | undefined, time?: string): string {
  const day = formatDate(date, time)
  const clock = formatTime(date, time)
  return clock ? `${day} · ${clock}` : day
}

/* ---------- News timestamps ---------- */

/**
 * News is read as an age rather than a date: "12 min ago" up close, and a plain
 * day — "Sat 11 Oct" — once a story is more than a week old.
 */
export function formatRelativeTime(millis: number, now: number = Date.now()): string {
  const minutes = Math.round((now - millis) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`

  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} d ago`

  return localCompact.format(new Date(millis))
}

/**
 * Human-friendly weekend range, e.g. "Fri 23 – Sun 25 Oct 2026". Takes calendar
 * days, which are already local by the time they get here.
 */
export function formatDateRange(start: string | undefined, end: string | undefined): string {
  if (!start || !end) return formatDate(end ?? start)
  if (start === end) return formatDate(end)

  const startDay = parseCalendarDay(start)
  const endDay = parseCalendarDay(end)
  if (Number.isNaN(startDay.getTime()) || Number.isNaN(endDay.getTime())) return formatDate(end)

  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${dayWeekday.format(startDay)} ${dayNumber.format(startDay)} – ${dayWeekday.format(
      endDay,
    )} ${dayMonthYear.format(endDay)}`
  }

  return `${dayCompact.format(startDay)} ${dayYear.format(startDay)} – ${dayCompact.format(
    endDay,
  )} ${dayYear.format(endDay)}`
}

/* ---------- Session timings ---------- */

export function driverName(driver: { givenName: string; familyName: string }): string {
  return `${driver.givenName} ${driver.familyName}`
}

/**
 * Parses the alpha API's lap and total times, which come as "1:32.741" or
 * "1:23:06.801", into milliseconds. Returns null for anything unexpected.
 */
export function parseSessionTime(value: string | undefined | null): number | null {
  if (!value) return null

  const parts = value.split(':')
  if (parts.length < 2 || parts.length > 3) return null

  const numbers = parts.map(Number)
  if (numbers.some((part) => !Number.isFinite(part))) return null

  const seconds =
    numbers.length === 3
      ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
      : numbers[0] * 60 + numbers[1]

  return Math.round(seconds * 1000)
}

/**
 * Gap to a reference time, e.g. "+0.149". The reference itself and any timing
 * we could not parse render as an em dash.
 */
export function formatGap(millis: number | null, reference: number | null): string {
  if (millis === null || reference === null) return '—'
  const delta = millis - reference
  if (delta <= 0) return '—'
  return `+${(delta / 1000).toFixed(3)}`
}

/** Statuses of cars that were still running when the flag fell. */
const RUNNING_STATUSES = new Set(['FINISHED', 'LAPPED'])

/**
 * The alpha API reports each car's own elapsed time rather than a gap, and for
 * a car that retired early that time is *shorter* than the winner's. Rendering
 * it raw would show a retirement as the fastest car on track, so the time cell
 * is rebuilt from the leader's laps and time:
 *
 *  - cars that stopped: their status
 *  - cars a lap or more down: "+1 Lap"
 *  - the rest: the winner's total, or their gap to it
 */
export function raceTimeLabel(
  entry: { time?: string; status?: string; laps?: number },
  leader: { laps: number | null; timeMillis: number | null },
): string {
  if (entry.status && !RUNNING_STATUSES.has(entry.status.toUpperCase())) {
    return entry.status
  }

  if (entry.laps != null && leader.laps != null && entry.laps < leader.laps) {
    const deficit = leader.laps - entry.laps
    return deficit === 1 ? '+1 Lap' : `+${deficit} Laps`
  }

  const millis = parseSessionTime(entry.time)
  if (millis === null) return entry.time ?? entry.status ?? '—'
  if (leader.timeMillis === null || millis <= leader.timeMillis) return entry.time ?? '—'
  return formatGap(millis, leader.timeMillis)
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

const compactFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
})

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const dayFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', timeZone: 'UTC' })
const yearFormatter = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'UTC' })
const dayMonthYearFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function parseDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** Race times come from the API in UTC, so we render them in UTC too. */
export function formatDate(date: string | undefined): string {
  if (!date) return '—'
  const parsed = parseDay(date)
  return Number.isNaN(parsed.getTime()) ? date : dateFormatter.format(parsed)
}

/** Compact day label, e.g. "Fri 23 Oct". */
export function formatCompactDate(date: string | undefined): string {
  if (!date) return '—'
  const parsed = parseDay(date)
  return Number.isNaN(parsed.getTime()) ? date : compactFormatter.format(parsed)
}

/** Human-friendly weekend range, e.g. "Fri 23 – Sun 25 Oct 2026". */
export function formatDateRange(start: string | undefined, end: string | undefined): string {
  if (!start || !end) return formatDate(end ?? start)
  if (start === end) return formatDate(end)

  const startDate = parseDay(start)
  const endDate = parseDay(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return formatDate(end)

  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${weekdayFormatter.format(startDate)} ${dayFormatter.format(startDate)} – ${weekdayFormatter.format(
      endDate,
    )} ${dayMonthYearFormatter.format(endDate)}`
  }

  return `${formatCompactDate(start)} ${yearFormatter.format(startDate)} – ${formatCompactDate(
    end,
  )} ${yearFormatter.format(endDate)}`
}

export function formatTime(date: string | undefined, time: string | undefined): string {
  if (!time) return ''
  const parsed = new Date(`${date}T${time}`)
  return Number.isNaN(parsed.getTime()) ? '' : `${timeFormatter.format(parsed)} UTC`
}

export function formatDateTime(date: string | undefined, time?: string): string {
  const day = formatDate(date)
  const clock = formatTime(date, time)
  return clock ? `${day} · ${clock}` : day
}

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

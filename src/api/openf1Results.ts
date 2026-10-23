import type { OpenF1Driver, OpenF1SessionResult } from './openf1'
import { openf1, resolveSessionKey } from './openf1'
import type { AlphaSessionEntry, AlphaSessionResults, Race, SessionCode } from './types'
import { raceSchedule } from '../lib/schedule'

const PRACTICE_TITLES: Partial<Record<SessionCode, string>> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
}

export function isPracticeSession(code: SessionCode): boolean {
  return code === 'FP1' || code === 'FP2' || code === 'FP3'
}

/** OpenF1 reports a practice best lap as decimal seconds, e.g. 77.565. */
function formatLapTime(seconds: number | null | undefined): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return undefined
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds - minutes * 60
  return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`
}

/** OpenF1 sends `team_colour` without the leading hash. */
function teamColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.startsWith('#') ? value : `#${value}`
}

function splitName(driver: OpenF1Driver): { given: string; family: string } {
  if (driver.first_name && driver.last_name) {
    return { given: driver.first_name, family: driver.last_name }
  }
  const parts = driver.full_name.trim().split(/\s+/)
  return { given: parts[0] ?? driver.name_acronym, family: parts.slice(1).join(' ') }
}

/**
 * Provisional practice classification from OpenF1, shaped like an alpha
 * session so the existing table renders it unchanged.
 *
 * OpenF1 is the fallback rather than the normal path: jolpica is canonical as
 * soon as it publishes. Returns null while the session is still live (the free
 * tier answers 401), when nothing maps, or when the classification is empty.
 */
export async function practiceResults(
  race: Race,
  code: SessionCode,
  roundId: string | undefined,
  signal?: AbortSignal,
): Promise<AlphaSessionResults | null> {
  if (!isPracticeSession(code)) return null

  try {
    const resolved = await resolveSessionKey(race, code)
    if (!resolved) return null

    const rows = await openf1.sessionResult(resolved.sessionKey, signal)
    if (rows.length === 0) return null

    const drivers = await openf1.drivers(resolved.sessionKey, signal)
    const driverByNumber = new Map(drivers.map((driver) => [driver.driver_number, driver]))
    const entry = raceSchedule(race).find((candidate) => candidate.code === code)
    const timestamp = entry ? `${entry.date}T${entry.time ?? '00:00:00Z'}` : race.date

    const positionOf = (row: OpenF1SessionResult) =>
      typeof row.position === 'number' ? row.position : Number.MAX_SAFE_INTEGER

    const results: AlphaSessionEntry[] = [...rows]
      .sort((a, b) => positionOf(a) - positionOf(b))
      .map((row, index) => {
        const driver = driverByNumber.get(row.driver_number)
        const position = typeof row.position === 'number' ? row.position : index + 1
        const name = driver
          ? splitName(driver)
          : { given: `#${row.driver_number}`, family: '' }
        const teamName = driver?.team_name ?? '—'

        return {
          driver: {
            id: String(row.driver_number),
            abbreviation: driver?.name_acronym,
            given_name: name.given,
            family_name: name.family,
            permanent_car_number: row.driver_number,
          },
          team: {
            id: teamName,
            name: teamName,
            primary_color: teamColor(driver?.team_colour),
          },
          position,
          position_text: String(position),
          time: formatLapTime(typeof row.duration === 'number' ? row.duration : undefined),
          laps: row.number_of_laps ?? undefined,
          is_classified: true,
        }
      })

    return {
      code,
      title: PRACTICE_TITLES[code] ?? 'Practice',
      timestamp,
      round: {
        id: roundId ?? race.round,
        number: Number(race.round),
        name: race.raceName,
      },
      circuit: {
        id: race.Circuit.circuitId,
        name: race.Circuit.circuitName,
        locality: race.Circuit.Location.locality,
        country_code: race.Circuit.Location.country,
      },
      results,
    }
  } catch {
    // A provisional extra: 401 during the live window, 429 or a network
    // failure must leave the caller on the normal "not published yet" path.
    return null
  }
}

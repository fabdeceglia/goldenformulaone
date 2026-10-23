import type { OpenF1Driver, OpenF1SessionResult } from './openf1'
import { SHORT_REQUEST_GAP_MS, openf1, resolveSessionKey } from './openf1'
import type { AlphaSessionEntry, AlphaSessionResults, Race, SessionCode } from './types'
import { readPracticeCache, writePracticeCache } from '../lib/practiceCache'
import { raceSchedule } from '../lib/schedule'

export type PracticeResults =
  | { status: 'ready'; session: AlphaSessionResults }
  | { status: 'unavailable'; reason: 'locked' | 'empty' | 'error' }

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
 * soon as it publishes. The free tier answers 401 for every endpoint while a
 * live session is running, so a previously fetched table is kept in local
 * storage and served until OpenF1 is reachable again.
 */
export async function practiceResults(
  race: Race,
  code: SessionCode,
  roundId: string | undefined,
  signal?: AbortSignal,
): Promise<PracticeResults> {
  if (!isPracticeSession(code)) return { status: 'unavailable', reason: 'empty' }

  const cached = readPracticeCache(race.season, race.round, code)

  try {
    const resolved = await resolveSessionKey(race, code, SHORT_REQUEST_GAP_MS)
    if (!resolved) {
      return cached
        ? { status: 'ready', session: cached }
        : { status: 'unavailable', reason: 'empty' }
    }

    const rows = await openf1.sessionResult(
      resolved.sessionKey,
      signal,
      SHORT_REQUEST_GAP_MS,
    )
    if (rows.length === 0) {
      return cached
        ? { status: 'ready', session: cached }
        : { status: 'unavailable', reason: 'empty' }
    }

    const drivers = await openf1.drivers(resolved.sessionKey, signal, SHORT_REQUEST_GAP_MS)
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

    const session: AlphaSessionResults = {
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

    writePracticeCache(race.season, race.round, code, session)
    return { status: 'ready', session }
  } catch (cause) {
    // Keep the table already fetched for this session on screen through the
    // next live window, when OpenF1 blocks even historical requests.
    if (cached) return { status: 'ready', session: cached }

    const message = cause instanceof Error ? cause.message : ''
    return {
      status: 'unavailable',
      reason: message.includes('401') ? 'locked' : 'error',
    }
  }
}

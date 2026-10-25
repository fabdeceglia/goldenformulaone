import type { OpenF1Driver, OpenF1SessionResult } from './openf1'
import { SHORT_REQUEST_GAP_MS, openf1, resolveSessionKey } from './openf1'
import type {
  AlphaComponent,
  AlphaSessionEntry,
  AlphaSessionResults,
  Race,
  SessionCode,
} from './types'
import { QUALIFYING_SEGMENTS } from '../lib/grid'
import { readProvisionalCache, writeProvisionalCache } from '../lib/provisionalCache'
import { raceSchedule } from '../lib/schedule'

export type ProvisionalResults =
  | { status: 'ready'; session: AlphaSessionResults }
  | { status: 'unavailable'; reason: 'locked' | 'empty' | 'error' }

const FALLBACK_TITLES: Partial<Record<SessionCode, string>> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint Qualifying',
  SR: 'Sprint',
  Q: 'Qualifying',
  R: 'Race',
}

const FALLBACK_SESSIONS = new Set<SessionCode>(['FP1', 'FP2', 'FP3', 'SQ', 'SR', 'Q', 'R'])

const SEGMENT_NAMES: Record<string, string> = {
  Q1: 'Qualifying 1',
  Q2: 'Qualifying 2',
  Q3: 'Qualifying 3',
  SQ1: 'Sprint Qualifying 1',
  SQ2: 'Sprint Qualifying 2',
  SQ3: 'Sprint Qualifying 3',
}

/**
 * jolpica has been slow to publish classifications. These are the sessions
 * OpenF1 can fill in provisionally until it does.
 */
export function isOpenF1FallbackSession(code: SessionCode): boolean {
  return FALLBACK_SESSIONS.has(code)
}

/** OpenF1 reports times as decimal seconds, e.g. 77.565 or 6120.785. */
function formatSessionTime(seconds: number | null | undefined): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return undefined

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`
  }

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
 * Practice and the race carry one duration as a number; qualifying carries one
 * best lap per segment in an array. Build the same `components` map jolpica
 * uses, so the table and starting grid render a provisional classification
 * exactly like the canonical one.
 */
function sessionTime(
  row: OpenF1SessionResult,
  code: SessionCode,
): { time?: string; components?: Record<string, AlphaComponent> } {
  const segments = QUALIFYING_SEGMENTS[code]

  if (!segments) {
    return {
      time: formatSessionTime(typeof row.duration === 'number' ? row.duration : undefined),
    }
  }

  const durations = Array.isArray(row.duration) ? row.duration : []
  const components: Record<string, AlphaComponent> = {}
  let time: string | undefined

  segments.forEach((segment, index) => {
    const segmentTime = formatSessionTime(durations[index])
    if (!segmentTime) return

    components[segment] = {
      key: segment,
      name: SEGMENT_NAMES[segment] ?? segment,
      time: segmentTime,
    }
    // The final segment a driver reached is their classification time, just as
    // jolpica reports it (Q3 for the top ten, Q2 or Q1 for the rest).
    time = segmentTime
  })

  return {
    time,
    components: Object.keys(components).length > 0 ? components : undefined,
  }
}

/** OpenF1 reports the reason a car stopped as flags rather than a status string. */
function raceStatus(row: OpenF1SessionResult): string {
  if (row.dsq) return 'DSQ'
  if (row.dns) return 'DNS'
  if (row.dnf) return 'RETIRED'
  if (typeof row.gap_to_leader === 'string' && /LAP/i.test(row.gap_to_leader)) return 'LAPPED'
  return 'FINISHED'
}

/**
 * OpenF1's starting-grid feed is keyed to the qualifying/sprint-qualifying
 * session, not the race. It is the actual grid (including penalties), not just
 * the qualifying order. Use it for the race grid; if it is unavailable, fall
 * back to the qualifying classification. A failure here only costs the grid
 * column, not the classification.
 */
async function startingGrid(
  race: Race,
  code: SessionCode,
  signal?: AbortSignal,
): Promise<Map<number, number>> {
  const gridCode: SessionCode | null = code === 'R' ? 'Q' : code === 'SR' ? 'SQ' : null
  if (!gridCode) return new Map()

  try {
    const resolved = await resolveSessionKey(race, gridCode, SHORT_REQUEST_GAP_MS)
    if (!resolved) return new Map()

    try {
      const rows = await openf1.startingGrid(
        resolved.sessionKey,
        signal,
        SHORT_REQUEST_GAP_MS,
      )
      if (rows.length > 0) {
        return new Map(rows.map((row) => [row.driver_number, row.position]))
      }
    } catch (cause) {
      if (signal?.aborted) throw cause
    }

    // The grid feed is normally available for qualifying. If it is not, fall
    // back to the qualifying classification: the same order minus any grid
    // penalties, and it may omit drivers without a qualifying time. A blank
    // grid is less useful than a provisional one.
    const rows = await openf1.sessionResult(
      resolved.sessionKey,
      signal,
      SHORT_REQUEST_GAP_MS,
    )
    return new Map(
      rows
        .filter((row) => typeof row.position === 'number')
        .map((row) => [row.driver_number, row.position as number]),
    )
  } catch (cause) {
    if (signal?.aborted) throw cause
    return new Map()
  }
}

/**
 * Provisional classification from OpenF1, shaped like an alpha session so the
 * existing table and grid render it unchanged.
 *
 * OpenF1 is the fallback rather than the normal path: jolpica is canonical as
 * soon as it publishes. The free tier answers 401 for every endpoint while a
 * live session is running, so a previously fetched table is kept in local
 * storage and served until OpenF1 is reachable again.
 */
export async function provisionalResults(
  race: Race,
  code: SessionCode,
  roundId: string | undefined,
  signal?: AbortSignal,
): Promise<ProvisionalResults> {
  if (!isOpenF1FallbackSession(code)) return { status: 'unavailable', reason: 'empty' }

  const cached = readProvisionalCache(race.season, race.round, code)

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
    const segments = QUALIFYING_SEGMENTS[code]
    const isRace = code === 'R' || code === 'SR'
    const gridByDriver = await startingGrid(race, code, signal)

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
        const { time, components: segmentComponents } = sessionTime(row, code)
        const components: Record<string, AlphaComponent> = segmentComponents
          ? { ...segmentComponents }
          : {}

        const gridPosition = isRace ? gridByDriver.get(row.driver_number) : undefined
        if (gridPosition !== undefined) {
          components.GRID = { key: 'GRID', name: 'Grid Position', position: gridPosition }
        }

        const classified =
          !row.dnf && !row.dns && !row.dsq && (!segments || time !== undefined)

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
          position_text: classified ? String(position) : 'NC',
          time,
          laps: row.number_of_laps ?? undefined,
          is_classified: classified,
          car_number: row.driver_number,
          status: isRace ? raceStatus(row) : undefined,
          points: isRace ? (row.points ?? undefined) : undefined,
          components: Object.keys(components).length > 0 ? components : undefined,
        }
      })

    const componentKeys = segments
      ? [...segments]
      : isRace && gridByDriver.size > 0
        ? ['GRID']
        : undefined

    const session: AlphaSessionResults = {
      code,
      title: FALLBACK_TITLES[code] ?? code,
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
      component_keys: componentKeys,
      results,
    }

    writeProvisionalCache(race.season, race.round, code, session)
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

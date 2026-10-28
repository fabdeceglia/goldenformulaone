import type {
  AlphaComponent,
  AlphaSessionEntry,
  AlphaSessionResults,
  SessionCode,
} from '../api/types'

/**
 * Pure OpenF1 -> `AlphaSessionResults` mapping.
 *
 * Kept free of `fetch`, browser globals and `import.meta.env` so the Worker and
 * the browser can share exactly the same table shape.
 */

export const QUALIFYING_SEGMENTS: Partial<Record<SessionCode, readonly string[]>> = {
  Q: ['Q1', 'Q2', 'Q3'],
  SQ: ['SQ1', 'SQ2', 'SQ3'],
}

const SEGMENT_NAMES: Record<string, string> = {
  Q1: 'Qualifying 1',
  Q2: 'Qualifying 2',
  Q3: 'Qualifying 3',
  SQ1: 'Sprint Qualifying 1',
  SQ2: 'Sprint Qualifying 2',
  SQ3: 'Sprint Qualifying 3',
}

export const SESSION_TITLES: Record<SessionCode, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint Qualifying',
  SR: 'Sprint',
  Q: 'Qualifying',
  R: 'Race',
}

/** One row of OpenF1's final classification (`/session_result`). */
export interface OpenF1ResultRow {
  session_key?: number
  driver_number: number
  position?: number | null
  /** Seconds for practice and the race, an array of segment laps for qualifying. */
  duration?: number | (number | null)[] | null
  gap_to_leader?: number | string | (number | null)[] | null
  number_of_laps?: number | null
  points?: number | null
  dnf?: boolean
  dns?: boolean
  dsq?: boolean
}

/** One row of OpenF1's `/drivers` feed for a session. */
export interface OpenF1DriverRow {
  driver_number: number
  broadcast_name?: string
  full_name?: string
  name_acronym?: string
  team_name?: string
  team_colour?: string
  first_name?: string
  last_name?: string
}

export interface OpenF1MapInput {
  code: SessionCode
  timestamp: string
  round: AlphaSessionResults['round']
  circuit?: AlphaSessionResults['circuit']
  drivers: readonly OpenF1DriverRow[]
  /** Grid slots keyed by driver number, for races and sprints. */
  gridByDriver?: ReadonlyMap<number, number>
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

function splitName(driver: OpenF1DriverRow): { given: string; family: string } {
  if (driver.first_name && driver.last_name) {
    return { given: driver.first_name, family: driver.last_name }
  }
  const parts = (driver.full_name ?? '').trim().split(/\s+/)
  return {
    given: parts[0] ?? driver.name_acronym ?? String(driver.driver_number),
    family: parts.slice(1).join(' '),
  }
}

/**
 * Practice and the race carry one duration as a number; qualifying carries one
 * best lap per segment in an array. Build the same `components` map jolpica
 * uses, so the table and starting grid render a provisional classification
 * exactly like the canonical one.
 */
function sessionTime(
  row: OpenF1ResultRow,
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
function raceStatus(row: OpenF1ResultRow): string {
  if (row.dsq) return 'DSQ'
  if (row.dns) return 'DNS'
  if (row.dnf) return 'RETIRED'
  if (typeof row.gap_to_leader === 'string' && /LAP/i.test(row.gap_to_leader)) return 'LAPPED'
  return 'FINISHED'
}

/**
 * The raw counts used by the completeness check. They are deliberately taken
 * from OpenF1 rows, before the mapper's MAX_SAFE_INTEGER sentinel can make an
 * unclassified row look positioned.
 */
export function rawCompleteness(rows: readonly OpenF1ResultRow[]): {
  drivers: number
  positioned: number
  classified: number
  hasWinner: boolean
} {
  return {
    drivers: rows.length,
    positioned: rows.filter((row) => typeof row.position === 'number' && row.position > 0).length,
    classified: rows.filter(
      (row) =>
        typeof row.position === 'number' &&
        row.position > 0 &&
        !row.dnf &&
        !row.dns &&
        !row.dsq,
    ).length,
    hasWinner: rows.some((row) => row.position === 1),
  }
}

export function mapOpenF1Results(
  rows: readonly OpenF1ResultRow[],
  input: OpenF1MapInput,
): AlphaSessionResults {
  const { code, drivers, gridByDriver } = input
  const driverByNumber = new Map(drivers.map((driver) => [driver.driver_number, driver]))
  const segments = QUALIFYING_SEGMENTS[code]
  const isRace = code === 'R' || code === 'SR'

  const positionOf = (row: OpenF1ResultRow) =>
    typeof row.position === 'number' && row.position > 0
      ? row.position
      : Number.MAX_SAFE_INTEGER

  const results: AlphaSessionEntry[] = [...rows]
    .sort((a, b) => positionOf(a) - positionOf(b))
    .map((row) => {
      const driver = driverByNumber.get(row.driver_number)
      const hasPosition = typeof row.position === 'number' && row.position > 0
      // A sentinel, never a real classification. `position_text` is NC, so the
      // UI shows the retirement/DNS marker rather than an invented place.
      const position = hasPosition ? (row.position as number) : Number.MAX_SAFE_INTEGER
      const name = driver
        ? splitName(driver)
        : { given: `#${row.driver_number}`, family: '' }
      const teamName = driver?.team_name ?? '—'
      const { time, components: segmentComponents } = sessionTime(row, code)
      const components: Record<string, AlphaComponent> = segmentComponents
        ? { ...segmentComponents }
        : {}

      const gridPosition = isRace ? gridByDriver?.get(row.driver_number) : undefined
      if (gridPosition !== undefined) {
        components.GRID = { key: 'GRID', name: 'Grid Position', position: gridPosition }
      }

      const classified =
        hasPosition &&
        !row.dnf &&
        !row.dns &&
        !row.dsq &&
        (!segments || time !== undefined)

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
    : isRace && (gridByDriver?.size ?? 0) > 0
      ? ['GRID']
      : undefined

  return {
    code,
    title: SESSION_TITLES[code],
    timestamp: input.timestamp,
    round: input.round,
    circuit: input.circuit,
    component_keys: componentKeys,
    results,
  }
}

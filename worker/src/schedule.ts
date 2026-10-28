import type { Race, SessionCode } from '../../src/api/types'
import type { SessionWindow } from '../../src/shared/schedule'
import { keys, readMeta, writeMeta } from './cache'
import {
  CALENDAR_TTL_MS,
  DRIVERS_TTL_MS,
  FALLBACK_EXPECTED_DRIVERS,
  OPENF1_SESSIONS_TTL_MS,
  ROUNDS_TTL_MS,
  type Env,
} from './config'
import type { SourceOptions } from './sources/jolpica'
import { fetchCalendar, fetchExpectedDrivers, fetchRoundIds } from './sources/jolpica'
import { fetchSessions, type OpenF1SessionRow } from './sources/openf1'

/**
 * Cached metadata needed to turn a round number into an alpha round id and a
 * session window. Each entry is refreshed on a long TTL and a failed refresh
 * falls back to the stale value rather than blanking the results page.
 */

export interface SessionTarget {
  season: string
  round: string
  code: SessionCode
  race: Race
  window: SessionWindow
}

function stale<T>(entry: { data: T } | null): T | null {
  return entry?.data ?? null
}

export function currentSeason(now: number): string {
  return String(new Date(now).getUTCFullYear())
}

export async function loadCalendar(
  env: Env,
  season: string,
  options: SourceOptions,
): Promise<Race[]> {
  const cached = await readMeta<Race[]>(env, keys.calendar(season))
  if (cached && options.now - cached.savedAt < CALENDAR_TTL_MS) return cached.data

  try {
    const races = await fetchCalendar(season, env, options)
    if (races.length === 0) throw new Error(`Empty calendar for ${season}`)
    await writeMeta(env, keys.calendar(season), races, options.now)
    return races
  } catch (cause) {
    const previous = stale(cached)
    if (previous && previous.length > 0) return previous
    throw cause
  }
}

export async function loadRoundIds(
  env: Env,
  season: string,
  options: SourceOptions,
): Promise<Record<string, string>> {
  const cached = await readMeta<Record<string, string>>(env, keys.rounds(season))
  if (cached && options.now - cached.savedAt < ROUNDS_TTL_MS) return cached.data

  try {
    const rounds = await fetchRoundIds(season, env, options)
    if (Object.keys(rounds).length > 0) {
      await writeMeta(env, keys.rounds(season), rounds, options.now)
      return rounds
    }
  } catch {
    // Fall through to a stale map when there is one.
  }

  return stale(cached) ?? {}
}

export async function loadExpectedDrivers(
  env: Env,
  season: string,
  options: SourceOptions,
): Promise<number> {
  const cached = await readMeta<number>(env, keys.drivers(season))
  if (cached && options.now - cached.savedAt < DRIVERS_TTL_MS) return cached.data

  const count = await fetchExpectedDrivers(season, env, options)
  if (count !== FALLBACK_EXPECTED_DRIVERS || !cached) {
    await writeMeta(env, keys.drivers(season), count, options.now)
  }
  return count === FALLBACK_EXPECTED_DRIVERS && cached ? cached.data : count
}

export async function loadOpenF1Sessions(
  env: Env,
  season: string,
  options: SourceOptions,
): Promise<OpenF1SessionRow[]> {
  const cached = await readMeta<OpenF1SessionRow[]>(env, keys.openf1Sessions(season))
  if (cached && options.now - cached.savedAt < OPENF1_SESSIONS_TTL_MS) return cached.data

  try {
    const sessions = await fetchSessions(season, env, options)
    if (sessions.length === 0) throw new Error(`Empty OpenF1 session list for ${season}`)
    await writeMeta(env, keys.openf1Sessions(season), sessions, options.now)
    return sessions
  } catch {
    // The OpenF1 fallback is enrichment; a missing list must not block jolpica.
    return stale(cached) ?? []
  }
}

export function findRace(races: readonly Race[], round: string): Race | undefined {
  return races.find((race) => race.round === round)
}

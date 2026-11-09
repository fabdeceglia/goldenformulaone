import { buildDriverSeason } from '../lib/driverSeason'
import type { DriverSeason } from '../lib/driverSeason'
import { api } from './client'

const CACHE_TTL_MS = 10 * 60 * 1000

/** Resets on reload, which is the right lifetime for a chart nobody keeps open. */
const cache = new Map<string, { savedAt: number; data: DriverSeason }>()

/**
 * One driver's season in three parallel requests. The dialog fetches nothing
 * else; a fresh result is served from memory so reopening any driver is instant.
 */
export async function fetchDriverSeason(
  season: string,
  driverId: string,
  signal: AbortSignal,
): Promise<DriverSeason> {
  const key = `${season}:${driverId}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.data

  const [results, sprints, qualifying] = await Promise.all([
    api.driverRaceResults(season, driverId, signal),
    api.driverSprintResults(season, driverId, signal),
    api.driverQualifying(season, driverId, signal),
  ])

  const data = buildDriverSeason(
    driverId,
    results.MRData.RaceTable.Races,
    sprints.MRData.RaceTable.Races,
    qualifying.MRData.RaceTable.Races,
  )

  cache.set(key, { savedAt: Date.now(), data })
  return data
}

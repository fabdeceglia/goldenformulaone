import { buildConstructorSeason } from '../lib/constructorSeason'
import type { ConstructorSeason } from '../lib/constructorSeason'
import { api } from './client'

const CACHE_TTL_MS = 10 * 60 * 1000

/** Resets on reload, like the driver chart's cache. */
const cache = new Map<string, { savedAt: number; data: ConstructorSeason }>()

/**
 * One constructor's season in three parallel requests, both cars per race. The
 * dialog fetches nothing else; a fresh result is served from memory so reopening
 * any team is instant.
 */
export async function fetchConstructorSeason(
  season: string,
  constructorId: string,
  signal: AbortSignal,
): Promise<ConstructorSeason> {
  const key = `${season}:${constructorId}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.data

  const [results, sprints, qualifying] = await Promise.all([
    api.constructorRaceResults(season, constructorId, signal),
    api.constructorSprintResults(season, constructorId, signal),
    api.constructorQualifying(season, constructorId, signal),
  ])

  const data = buildConstructorSeason(
    constructorId,
    results.MRData.RaceTable.Races,
    sprints.MRData.RaceTable.Races,
    qualifying.MRData.RaceTable.Races,
  )

  cache.set(key, { savedAt: Date.now(), data })
  return data
}

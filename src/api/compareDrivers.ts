import { buildCompareStat, buildHeadToHead } from '../lib/driverCompare'
import type { DriverCompareStat, HeadToHead } from '../lib/driverCompare'
import { api } from './client'
import { fetchDriverSeason } from './driverSeason'

export interface CompareEntry {
  driverId: string
  /** Ergast team id. The team-mate record needs it; without one the axis is empty. */
  constructorId?: string
}

const CACHE_TTL_MS = 10 * 60 * 1000

/** Team-mate records, keyed per driver and team so a mid-season move is exact. */
const headToHeadCache = new Map<string, { savedAt: number; data: HeadToHead }>()

/**
 * The radar's numbers for the picked drivers, in the order they were picked.
 *
 * Season data comes from the shared per-driver cache the stats dialog fills. The
 * team-mate comparison costs one extra qualifying request per team, because the
 * per-driver endpoint never returns the other car.
 */
export async function fetchDriverCompare(
  season: string,
  entries: readonly CompareEntry[],
  signal: AbortSignal,
): Promise<DriverCompareStat[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const [driverSeason, headToHead] = await Promise.all([
        fetchDriverSeason(season, entry.driverId, signal),
        fetchHeadToHead(season, entry, signal),
      ])
      return buildCompareStat(driverSeason, headToHead)
    }),
  )
}

async function fetchHeadToHead(
  season: string,
  entry: CompareEntry,
  signal: AbortSignal,
): Promise<HeadToHead | null> {
  if (!entry.constructorId) return null

  const key = `${season}:${entry.constructorId}:${entry.driverId}`
  const cached = headToHeadCache.get(key)
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.data

  const response = await api.constructorQualifying(season, entry.constructorId, signal)
  const data = buildHeadToHead(entry.driverId, response.MRData.RaceTable.Races)

  headToHeadCache.set(key, { savedAt: Date.now(), data })
  return data
}

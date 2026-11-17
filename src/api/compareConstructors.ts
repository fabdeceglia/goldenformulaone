import { buildConstructorCompareStat } from '../lib/constructorCompare'
import type { ConstructorCompareStat } from '../lib/constructorCompare'
import { fetchConstructorSeason } from './constructorSeason'

/**
 * The radar's numbers for the picked teams, in the order they were picked. One
 * cached call per team: the constructor season already aggregates both cars, so
 * unlike the driver chart this needs nothing extra.
 */
export async function fetchConstructorCompare(
  season: string,
  constructorIds: readonly string[],
  signal: AbortSignal,
): Promise<ConstructorCompareStat[]> {
  return Promise.all(
    constructorIds.map(async (constructorId) =>
      buildConstructorCompareStat(await fetchConstructorSeason(season, constructorId, signal)),
    ),
  )
}

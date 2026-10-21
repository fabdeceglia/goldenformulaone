/**
 * Season-wide cache of the alpha API's opaque round ids.
 *
 * Only the mapping from Ergast round number to alpha round id is stored here.
 * That mapping is fixed for the lifetime of an event, whereas session
 * classifications change throughout a weekend, so caching results would risk
 * serving a stale classification. Round ids are safe to reuse and save the
 * results page from waiting on the flaky 64KB `/core/rounds/` response before
 * it can request anything at all.
 */

export interface RoundId {
  number: string
  id: string
}

export interface CachedRounds {
  savedAt: number
  rounds: RoundId[]
}

/** How long a cached mapping is trusted without a background revalidation. */
export const ROUNDS_CACHE_TTL_MS = 6 * 60 * 60 * 1000

const CACHE_VERSION = 'v1'
const CACHE_PREFIX = 'box-this-lap:rounds'

function storageKey(season: string): string {
  return `${CACHE_PREFIX}:${CACHE_VERSION}:${season}`
}

function isRoundId(value: unknown): value is RoundId {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RoundId>
  return typeof candidate.number === 'string' && typeof candidate.id === 'string'
}

function isCachedRounds(value: unknown): value is CachedRounds {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CachedRounds>
  return (
    typeof candidate.savedAt === 'number' &&
    Number.isFinite(candidate.savedAt) &&
    Array.isArray(candidate.rounds) &&
    candidate.rounds.every(isRoundId)
  )
}

/**
 * Reads the cached mapping for a season. Returns null for every failure mode -
 * missing entry, private browsing, disabled storage, corrupted JSON - because a
 * missing cache is equivalent to a cold start, not an error worth surfacing.
 */
export function readRoundsCache(season: string): CachedRounds | null {
  if (!season) return null

  try {
    const raw = localStorage.getItem(storageKey(season))
    if (raw === null) return null

    const parsed: unknown = JSON.parse(raw)
    return isCachedRounds(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Writes the mapping for a season, ignoring storage failures such as a full
 * quota. The cache is an optimisation, so losing a write must never break the
 * page that triggered it.
 */
export function writeRoundsCache(season: string, rounds: readonly RoundId[]): void {
  if (!season) return

  try {
    const stored: CachedRounds = {
      savedAt: Date.now(),
      rounds: rounds.map((round) => ({ number: round.number, id: round.id })),
    }
    localStorage.setItem(storageKey(season), JSON.stringify(stored))
  } catch {
    // Quota errors and blocked storage simply mean there is no cache.
  }
}

/**
 * Whether a cached mapping is recent enough to skip the network request. Stale
 * entries stay usable; only the revalidation decision depends on this.
 */
export function isRoundsCacheFresh(cached: CachedRounds, now: number = Date.now()): boolean {
  const age = now - cached.savedAt
  return age >= 0 && age < ROUNDS_CACHE_TTL_MS
}

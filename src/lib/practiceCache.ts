import type { AlphaSessionResults } from '../api/types'

/**
 * The last provisional practice classification fetched from OpenF1.
 *
 * OpenF1's free tier blocks every endpoint, including past sessions, while a
 * live session is in progress. Keeping the last successful practice table in
 * localStorage means the results already shown for an earlier session do not
 * disappear just because the next session has started.
 *
 * This is deliberately only a fallback cache: a fresh OpenF1 response always
 * replaces it, and it is read only when that request fails.
 */
const CACHE_VERSION = 'v1'
const CACHE_PREFIX = 'box-this-lap:practice-results'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface StoredPracticeResults {
  savedAt: number
  data: AlphaSessionResults
}

function storageKey(season: string, round: string, code: string): string {
  return `${CACHE_PREFIX}:${CACHE_VERSION}:${season}:${round}:${code}`
}

function isStoredPracticeResults(
  value: unknown,
  code: string,
): value is StoredPracticeResults {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<StoredPracticeResults>
  const data = candidate.data
  return (
    typeof candidate.savedAt === 'number' &&
    Number.isFinite(candidate.savedAt) &&
    !!data &&
    typeof data === 'object' &&
    data.code === code &&
    Array.isArray(data.results)
  )
}

export function readPracticeCache(
  season: string,
  round: string,
  code: string,
  now: number = Date.now(),
): AlphaSessionResults | null {
  try {
    const raw = localStorage.getItem(storageKey(season, round, code))
    if (raw === null) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isStoredPracticeResults(parsed, code)) return null

    const age = now - parsed.savedAt
    if (age < 0 || age > MAX_AGE_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

export function writePracticeCache(
  season: string,
  round: string,
  code: string,
  data: AlphaSessionResults,
): void {
  try {
    const stored: StoredPracticeResults = { savedAt: Date.now(), data }
    localStorage.setItem(storageKey(season, round, code), JSON.stringify(stored))
  } catch {
    // Quota errors and blocked storage simply mean there is no cache.
  }
}

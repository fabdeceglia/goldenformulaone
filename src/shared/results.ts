import type { AlphaSessionResults, SessionCode } from '../api/types'

/**
 * Wire types shared by the results Worker and the browser.
 *
 * `CachedResult` is the durable KV value. `ResultsResponse` is the trimmed
 * public view; the revision, next-attempt and recheck bookkeeping stay on the
 * server.
 */

export type ResultState = 'pending' | 'provisional' | 'final'
export type SourceState = 'ready' | 'empty' | 'locked' | 'error'
export type ResultSource = 'jolpica' | 'openf1'

/** Persisted with a `CachedResult`; updated only when the summary changes. */
export interface SourceStatus {
  state: SourceState
  count: number
  complete: boolean
  checkedAt: string
  error?: string
  retryAt?: string
}

/** Returned by a refresh, not written to KV on every tick. */
export interface SourceCheck extends SourceStatus {
  source: ResultSource
  /** Internal scheduling hint; never persisted. */
  retryAfterMs?: number
}

export interface CachedResult {
  /** Bump when the persisted shape changes; an older version is refetched. */
  v: 2
  /** Monotonic per key. A writer refuses to replace a higher revision. */
  revision: number
  season: string
  round: string
  code: SessionCode
  state: ResultState
  source: ResultSource | null
  complete: boolean
  session: AlphaSessionResults | null
  fetchedAt: string | null
  /** The last **persisted** upstream check. */
  checkedAt: string
  nextAttemptAt: string | null
  /** Final results only: when the next amendment check is due. */
  recheckAt: string | null
  sources: {
    jolpica: SourceStatus
    openf1: SourceStatus
  }
}

export interface ResultsResponse {
  state: ResultState
  source: ResultSource | null
  complete: boolean
  session: AlphaSessionResults | null
  fetchedAt: string | null
  checkedAt: string
  pollAfterMs: number | null
  sources: CachedResult['sources']
}

export const RESULT_CACHE_VERSION = 2 as const

/** Sixty seconds matches KV's propagation window. */
export const RESULTS_POLL_MS = 60_000

const SESSION_CODES: readonly SessionCode[] = ['FP1', 'FP2', 'FP3', 'SQ', 'SR', 'Q', 'R']

export function isSessionCode(value: unknown): value is SessionCode {
  return typeof value === 'string' && (SESSION_CODES as readonly string[]).includes(value)
}

export function isResultState(value: unknown): value is ResultState {
  return value === 'pending' || value === 'provisional' || value === 'final'
}

export function isSourceState(value: unknown): value is SourceState {
  return value === 'ready' || value === 'empty' || value === 'locked' || value === 'error'
}

const RESULT_STATE_RANK: Record<ResultState, number> = {
  pending: 0,
  provisional: 1,
  final: 2,
}

export function resultStateRank(state: ResultState): number {
  return RESULT_STATE_RANK[state]
}

/** A source nobody has checked yet. */
export function emptySourceStatus(checkedAt = new Date(0).toISOString()): SourceStatus {
  return { state: 'empty', count: 0, complete: false, checkedAt }
}

export function isCachedResult(value: unknown): value is CachedResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CachedResult>
  return (
    candidate.v === RESULT_CACHE_VERSION &&
    typeof candidate.revision === 'number' &&
    typeof candidate.season === 'string' &&
    typeof candidate.round === 'string' &&
    isSessionCode(candidate.code) &&
    isResultState(candidate.state) &&
    (candidate.source === 'jolpica' || candidate.source === 'openf1' || candidate.source === null) &&
    typeof candidate.complete === 'boolean' &&
    typeof candidate.checkedAt === 'string' &&
    !!candidate.sources &&
    typeof candidate.sources === 'object'
  )
}

export interface CompletenessCounts {
  /** Rows returned by the source, one per driver. */
  drivers: number
  /** Rows carrying a real classification position. */
  positioned: number
  /** Rows that finished the session (not RET/DNS/DSQ). */
  classified: number
  /** The winner is present with position 1. */
  hasWinner: boolean
}

/**
 * The completeness rule from the plan, applied to **raw** source rows so a
 * mapper's fallback positions cannot promote a partial payload.
 */
export function assessCompleteness(
  counts: CompletenessCounts,
  expectedDrivers: number,
  code: SessionCode,
): { count: number; complete: boolean } {
  const expected = Math.max(1, expectedDrivers)
  const enoughDrivers = counts.drivers >= expected - 1
  const hasRealPosition = counts.positioned >= 1
  const raceComplete =
    code === 'R' || code === 'SR' ? counts.hasWinner && counts.classified >= 1 : true

  return {
    count: counts.drivers,
    complete: enoughDrivers && hasRealPosition && raceComplete,
  }
}

/** Counts from jolpica's already-mapped alpha rows. */
export function alphaCompleteness(session: AlphaSessionResults): CompletenessCounts {
  const rows = session.results ?? []
  return {
    drivers: rows.length,
    positioned: rows.filter((entry) => Number.isFinite(entry.position)).length,
    classified: rows.filter(
      (entry) =>
        entry.is_classified !== false &&
        entry.position_text?.toUpperCase() !== 'NC' &&
        Number.isFinite(entry.position),
    ).length,
    hasWinner: rows.some((entry) => entry.position === 1),
  }
}

function stableEntry(entry: AlphaSessionResults['results'][number]): unknown {
  const components = Object.keys(entry.components ?? {})
    .sort()
    .map((key) => {
      const component = entry.components?.[key]
      return [key, component?.position ?? null, component?.time ?? '']
    })

  return [
    entry.driver?.id ?? '',
    entry.position,
    entry.position_text ?? '',
    entry.time ?? '',
    entry.status ?? '',
    entry.points ?? 0,
    entry.is_classified ?? true,
    components,
  ]
}

/**
 * A stable fingerprint of the displayed classification. Used to decide whether
 * a final recheck actually amended anything, so an unchanged race does not
 * rewrite its result payload.
 */
export function classificationHash(session: AlphaSessionResults | null): string {
  if (!session) return ''

  const rows = [...(session.results ?? [])].sort((a, b) => a.position - b.position)
  const payload = JSON.stringify({ code: session.code, rows: rows.map(stableEntry) })

  // FNV-1a is plenty for change detection and has no crypto dependency.
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}

/** The parts of a result that make a KV write worthwhile. */
export function resultSignature(result: CachedResult): string {
  const status = (value: SourceStatus) => ({
    state: value.state,
    count: value.count,
    complete: value.complete,
    error: value.error ?? null,
    retryAt: value.retryAt ?? null,
  })

  return JSON.stringify({
    state: result.state,
    source: result.source,
    complete: result.complete,
    session: result.session ? classificationHash(result.session) : null,
    fetchedAt: result.fetchedAt,
    nextAttemptAt: result.nextAttemptAt,
    recheckAt: result.recheckAt,
    sources: {
      jolpica: status(result.sources.jolpica),
      openf1: status(result.sources.openf1),
    },
  })
}

export function toResultsResponse(cached: CachedResult): ResultsResponse {
  return {
    state: cached.state,
    source: cached.source,
    complete: cached.complete,
    session: cached.session,
    fetchedAt: cached.fetchedAt,
    checkedAt: cached.checkedAt,
    pollAfterMs: cached.state === 'final' ? null : RESULTS_POLL_MS,
    sources: cached.sources,
  }
}

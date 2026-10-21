import { getJson } from './http'
import type {
  AlphaEnvelope,
  AlphaResultsIndex,
  AlphaRound,
  AlphaSessionResults,
  SessionCode,
} from './types'

/**
 * jolpica's own API, where session results live. In development `/f1` is served
 * by the Vite proxy in `vite.config.ts`, which attaches the required User-Agent.
 */
const ALPHA_BASE = (import.meta.env.VITE_ALPHA_BASE as string | undefined) ?? '/f1/alpha'

/**
 * Alpha list endpoints answer either with a bare payload or wrapped in
 * `{ metadata, data }`, and that has been observed to change between requests.
 * Normalising here keeps every caller on one shape.
 */
function unwrap<T>(payload: T | AlphaEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'data' in payload && 'metadata' in payload) {
    return (payload as AlphaEnvelope<T>).data
  }
  return payload as T
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const payload = await getJson(`${ALPHA_BASE}${path}`, { signal })
  return unwrap<T>(payload as T | AlphaEnvelope<T>)
}

/**
 * The session codes this app knows how to render. Anything else the results
 * index offers is ignored rather than shown as an empty tab.
 */
export const SESSION_CODES: readonly SessionCode[] = ['FP1', 'FP2', 'FP3', 'SQ', 'SR', 'Q', 'R']

export const alpha = {
  /**
   * Every round of a season in one call. The results endpoints are keyed by an
   * opaque `round_id` such as `round_JqmngOvt`, so this is what lets us go from
   * an Ergast round number to fetchable results.
   */
  rounds: (year: string, signal: AbortSignal) =>
    get<AlphaRound[]>(`/core/rounds/?year=${year}`, signal),

  /** Which sessions a round has, straight from the API rather than guessed. */
  resultsIndex: (roundId: string, signal: AbortSignal) =>
    get<AlphaResultsIndex>(`/results/${roundId}/`, signal),

  /** The classification for one session of a round. */
  session: (roundId: string, code: SessionCode, signal: AbortSignal) =>
    get<AlphaSessionResults>(`/results/${roundId}/${code}/`, signal),
}

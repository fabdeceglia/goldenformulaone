import type { ResultsResponse } from '../shared/results'
import type { SessionCode } from './types'

export type { ResultsResponse }

/**
 * The browser's only results request.
 *
 * Same-origin by default: Vercel rewrites `/api/results/*` to the Worker in
 * production, and Vite proxies `/api` to `wrangler dev` locally. Set
 * `VITE_RESULTS_BASE` only if the Worker is called directly.
 */
const RESULTS_BASE =
  (import.meta.env.VITE_RESULTS_BASE as string | undefined) ?? '/api/results'

export async function sessionResults(
  season: string,
  round: string,
  code: SessionCode,
  signal: AbortSignal,
): Promise<ResultsResponse> {
  const url = `${RESULTS_BASE}/${encodeURIComponent(season)}/${encodeURIComponent(round)}/${code}`
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Results are not available for ${season} round ${round} ${code}.`)
    }
    throw new Error(`The results service responded with status ${response.status}.`)
  }

  return (await response.json()) as ResultsResponse
}

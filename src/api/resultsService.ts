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

/**
 * A bare `fetch` has no upper bound. The Worker normally answers in well under
 * a second, but the Vercel rewrite in front of it can hold a connection while
 * the Worker refreshes a session, and a stalled response would otherwise leave
 * the results panel on its spinner forever.
 */
const RESULTS_TIMEOUT_MS = 20_000

export async function sessionResults(
  season: string,
  round: string,
  code: SessionCode,
  signal: AbortSignal,
): Promise<ResultsResponse> {
  const url = `${RESULTS_BASE}/${encodeURIComponent(season)}/${encodeURIComponent(round)}/${code}`

  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  signal.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), RESULTS_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Results are not available for ${season} round ${round} ${code}.`)
      }
      throw new Error(`The results service responded with status ${response.status}.`)
    }

    return (await response.json()) as ResultsResponse
  } catch (cause) {
    // The caller's abort wins: it means the component went away, not that the
    // service is slow, so it must not be reported as a timeout.
    if (signal.aborted) throw cause
    if (controller.signal.aborted) {
      throw new Error('The results service took too long to respond.')
    }
    throw cause
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', forwardAbort)
  }
}

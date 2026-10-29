/**
 * Upstream relay.
 *
 * Cloudflare Workers subrequests to api.jolpi.ca carry `cf-cache-status:
 * BYPASS`, so every refresh reaches the origin, which rate-limits Cloudflare's
 * shared egress IPs and answers nginx 429. OpenF1 has the same shared-IP
 * problem with its three-requests-per-second budget. Both APIs are therefore
 * read through the small Vercel passthrough in `api/upstream.ts`, whose egress
 * is ordinary internet traffic and gets the normal cached response.
 *
 * The direct URL stays the primary source of truth: if the relay itself is
 * unavailable (5xx, timeout, network error), the request is retried straight
 * against the origin rather than failing the session.
 */

import { fetchJson, UpstreamError, type FetchOptions } from './http'

export function relayUrl(directUrl: string, relayBase: string | undefined): string {
  if (!relayBase) return directUrl
  const separator = relayBase.includes('?') ? '&' : '?'
  return `${relayBase}${separator}url=${encodeURIComponent(directUrl)}`
}

function relayFailure(cause: unknown): boolean {
  if (!(cause instanceof UpstreamError)) return true
  if (cause.kind === 'network' || cause.kind === 'timeout') return true
  return cause.status !== undefined && cause.status >= 500
}

export async function fetchViaRelay<T>(
  directUrl: string,
  relayBase: string | undefined,
  init: RequestInit,
  options: FetchOptions = {},
): Promise<T> {
  if (!relayBase) return fetchJson<T>(directUrl, init, options)

  try {
    return await fetchJson<T>(relayUrl(directUrl, relayBase), init, options)
  } catch (cause) {
    if (!relayFailure(cause)) throw cause
    return fetchJson<T>(directUrl, init, options)
  }
}

/**
 * jolpica passthrough for the results Worker.
 *
 * Cloudflare Workers subrequests to api.jolpi.ca are sent with
 * `cf-cache-status: BYPASS`, so each refresh reaches the origin, which
 * rate-limits Cloudflare's shared egress IPs and answers nginx 429. A Vercel
 * edge fetch leaves from a different network and gets the normal cached
 * response, so the Worker reads jolpica through this route instead.
 *
 * `/api/jolpica/f1/alpha/...` maps to `https://api.jolpi.ca/f1/alpha/...`.
 */

export const config = { runtime: 'edge' }

const UPSTREAM = 'https://api.jolpi.ca'
const USER_AGENT = 'GoldenFormulaOne/1.0.0 (+https://github.com/fabdeceglia/goldenformulaone)'

const PREFIX = '/api/jolpica'

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const raw = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname
  const path = raw.startsWith('/') ? raw : `/${raw}`
  const target = `${UPSTREAM}${path}${url.search}`

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    })
  } catch (cause) {
    return new Response(
      JSON.stringify({ error: cause instanceof Error ? cause.message : 'Upstream error' }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
  }

  const headers = new Headers()
  const type = upstream.headers.get('content-type')
  if (type) headers.set('content-type', type)
  const cacheControl = upstream.headers.get('cache-control')
  if (cacheControl) headers.set('cache-control', cacheControl)
  headers.set('access-control-allow-origin', '*')

  return new Response(upstream.body, { status: upstream.status, headers })
}

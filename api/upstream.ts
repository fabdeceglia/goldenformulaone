/**
 * Upstream passthrough for the results Worker.
 *
 * Cloudflare Workers subrequests to api.jolpi.ca carry
 * `cf-cache-status: BYPASS`, so every refresh reaches the origin, whose rate
 * limit rejects Cloudflare's shared egress IPs with an nginx 429. OpenF1 has
 * the same shared-IP problem with its three-requests-per-second budget. A
 * Vercel edge fetch is ordinary internet traffic and gets the normal cached
 * response, so the Worker reads both APIs through this route.
 *
 * Only the two upstream APIs are reachable, and only via the `url` parameter,
 * so the route cannot be used to fetch arbitrary hosts.
 */

export const config = { runtime: 'edge' }

const ALLOWED = ['https://api.jolpi.ca/', 'https://api.openf1.org/']

const USER_AGENT = 'GoldenFormulaOne/1.0.0 (+https://github.com/fabdeceglia/goldenformulaone)'

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
}

export default async function handler(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url')
  if (!target || !ALLOWED.some((prefix) => target.startsWith(prefix))) {
    return badRequest('url must point at a supported upstream')
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  }
  const authorization = request.headers.get('authorization')
  if (authorization) headers.Authorization = authorization

  let upstream: Response
  try {
    upstream = await fetch(target, { headers })
  } catch (cause) {
    return new Response(
      JSON.stringify({ error: cause instanceof Error ? cause.message : 'Upstream error' }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
  }

  const out = new Headers()
  const type = upstream.headers.get('content-type')
  if (type) out.set('content-type', type)
  const cacheControl = upstream.headers.get('cache-control')
  if (cacheControl) out.set('cache-control', cacheControl)
  out.set('access-control-allow-origin', '*')

  return new Response(upstream.body, { status: upstream.status, headers: out })
}

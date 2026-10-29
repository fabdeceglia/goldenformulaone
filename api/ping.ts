export const config = { runtime: 'edge' }

export default function handler(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  })
}

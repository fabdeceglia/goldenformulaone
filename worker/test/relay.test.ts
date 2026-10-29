import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchViaRelay, relayUrl } from '../src/relay'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const RELAY = 'https://app.test/api/upstream'
const DIRECT = 'https://jolpica.test/f1/alpha/results/round_1/R/'

describe('relayUrl', () => {
  it('leaves the direct URL alone without a relay', () => {
    expect(relayUrl(DIRECT, undefined)).toBe(DIRECT)
  })

  it('encodes the whole upstream URL into the relay query', () => {
    expect(relayUrl(DIRECT, RELAY)).toBe(`${RELAY}?url=${encodeURIComponent(DIRECT)}`)
  })
})

describe('fetchViaRelay', () => {
  it('reads through the relay', async () => {
    const fetchSpy = vi.fn((_input: unknown) => Promise.resolve(json({ ok: true })))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchViaRelay(DIRECT, RELAY, {})).resolves.toEqual({ ok: true })
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/upstream?url=')
  })

  it('falls back to the direct URL when the relay is unavailable', async () => {
    const fetchSpy = vi.fn((input: unknown) =>
      String(input).includes('/api/upstream')
        ? Promise.resolve(new Response('bad gateway', { status: 502, headers: { 'Retry-After': '0' } }))
        : Promise.resolve(json({ ok: true })),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchViaRelay(DIRECT, RELAY, {})).resolves.toEqual({ ok: true })
    expect(String(fetchSpy.mock.calls.at(-1)?.[0])).toBe(DIRECT)
  })

  it('does not retry directly on a real upstream error', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('not found', { status: 404 })))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchViaRelay(DIRECT, RELAY, {})).rejects.toThrow('HTTP 404')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('skips the relay entirely when none is configured', async () => {
    const fetchSpy = vi.fn((_input: unknown) => Promise.resolve(json({ ok: true })))
    vi.stubGlobal('fetch', fetchSpy)

    await fetchViaRelay(DIRECT, undefined, {})
    expect(String(fetchSpy.mock.calls[0][0])).toBe(DIRECT)
  })
})

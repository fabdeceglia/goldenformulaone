import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, UpstreamError } from '../src/http'

function text(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchJson retry', () => {
  it('retries a transient 429 and returns the next successful body', async () => {
    // `Retry-After: 0` keeps the test instant while exercising the retry path.
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(text('<html>429</html>', 429, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(text(JSON.stringify({ ok: true }), 200))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchJson<{ ok: boolean }>('https://jolpica.test/x', {})).resolves.toEqual({
      ok: true,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('gives up after three attempts and keeps the status', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(text('<html>429</html>', 429)))
    vi.stubGlobal('fetch', fetchSpy)

    const error = await fetchJson('https://jolpica.test/x', {}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(UpstreamError)
    expect((error as UpstreamError).status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 404', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(text('not found', 404)))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchJson('https://jolpica.test/x', {})).rejects.toThrow('HTTP 404')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the refresh deadline has no room left', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(text('<html>429</html>', 429)))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      fetchJson('https://jolpica.test/x', {}, { deadline: Date.now() + 200 }),
    ).rejects.toThrow('HTTP 429')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

/**
 * A small JSON GET with a per-request deadline.
 *
 * `fetch` has no upper bound: jolpica can send headers and then stall the body,
 * and OpenF1 can hold a connection too. Every call gets its own timeout, and an
 * on-demand refresh also passes an overall `deadline` so two sequential calls
 * cannot turn into a ten-second wait.
 */

export class UpstreamError extends Error {
  status: number | undefined
  retryAfterMs: number | undefined
  kind: 'http' | 'network' | 'timeout' | 'parse'

  constructor(
    message: string,
    options: {
      status?: number
      retryAfterMs?: number
      kind?: 'http' | 'network' | 'timeout' | 'parse'
    } = {},
  ) {
    super(message)
    this.name = 'UpstreamError'
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.kind = options.kind ?? 'network'
  }
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - Date.now())
}

export interface FetchOptions {
  /** Caller cancellation, e.g. the request's abort signal. */
  signal?: AbortSignal
  /** Per-request ceiling; defaults to five seconds. */
  timeoutMs?: number
  /** Absolute epoch-ms deadline for the whole refresh. */
  deadline?: number
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options: FetchOptions = {},
): Promise<T> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  options.signal?.addEventListener('abort', forwardAbort, { once: true })

  const remaining = options.deadline ? options.deadline - Date.now() : Number.POSITIVE_INFINITY
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 5_000, remaining))
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new UpstreamError(`HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`, {
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
        kind: 'http',
      })
    }

    try {
      return (await response.json()) as T
    } catch {
      throw new UpstreamError('Malformed JSON response', { kind: 'parse' })
    }
  } catch (cause) {
    if (cause instanceof UpstreamError) throw cause
    if (options.signal?.aborted) throw cause
    if (controller.signal.aborted) {
      throw new UpstreamError('Request timed out', { kind: 'timeout' })
    }
    throw new UpstreamError(cause instanceof Error ? cause.message : 'Network error', {
      kind: 'network',
    })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}

export function sleep(millis: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millis))
}

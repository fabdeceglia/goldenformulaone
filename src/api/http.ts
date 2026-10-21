/**
 * The JSON GET used by the jolpica clients.
 *
 * jolpica sometimes sends a complete response header and then stalls the body
 * for tens of seconds, or never finishes at all. A bare `fetch` therefore has
 * no upper bound: the promise can stay pending forever. Each attempt here gets
 * its own deadline that also covers reading and parsing the body.
 */

/** One stalled attempt is abandoned after this long. */
const DEFAULT_TIMEOUT_MS = 10_000

/** A single retry covers a stall or a transient upstream error. */
const DEFAULT_RETRIES = 1

/** Short pause before the retry, so a blip is not hammered. */
const RETRY_DELAY_MS = 500

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

class StatusError extends Error {
  status: number

  constructor(status: number) {
    super(`Request failed with status ${status}`)
    this.name = 'StatusError'
    this.status = status
  }
}

/** The reason the caller aborted, or an equivalent AbortError. */
function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * A pause that ends early when the caller aborts. Rejecting with the abort
 * reason keeps cancellation immediate instead of waiting out the backoff.
 */
function backoff(millis: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }

    let timer: ReturnType<typeof setTimeout>

    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, millis)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function isRetryable(cause: unknown): boolean {
  if (cause instanceof TimeoutError) return true
  // 5xx is transient. A 429 is jolpica's rate limiter (4 req/s, 500/hour), so
  // retrying it only deepens the hole; every other 4xx is a real client error.
  if (cause instanceof StatusError) return cause.status >= 500
  // fetch rejects with a TypeError for DNS, connection and other network failures.
  return cause instanceof TypeError
}

/** One attempt, with a deadline that covers the response body as well. */
async function requestOnce(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<unknown> {
  if (signal?.aborted) throw abortError(signal)

  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', forwardAbort, { once: true })

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      // Cancel the unread body, otherwise a stalled response keeps a
      // connection busy until the browser gives up on it.
      void response.body?.cancel().catch(() => {})
      throw new StatusError(response.status)
    }

    return (await response.json()) as unknown
  } catch (cause) {
    // The caller's abort wins over our deadline: report it as such and never retry.
    if (signal?.aborted) throw cause
    if (timedOut) throw new TimeoutError(`Request timed out after ${timeoutMs / 1000}s`)
    throw cause
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

export interface GetJsonOptions {
  signal?: AbortSignal
  /** Deadline per attempt. Defaults to 10 seconds. */
  timeoutMs?: number
  /** Extra attempts after the first. Defaults to 1, so at most 2 attempts. */
  retries?: number
}

export async function getJson(url: string, options: GetJsonOptions = {}): Promise<unknown> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const attempts = 1 + Math.max(0, options.retries ?? DEFAULT_RETRIES)

  for (let attempt = 1; ; attempt++) {
    try {
      return await requestOnce(url, signal, timeoutMs)
    } catch (cause) {
      if (signal?.aborted || attempt >= attempts || !isRetryable(cause)) throw cause
      await backoff(RETRY_DELAY_MS, signal)
    }
  }
}

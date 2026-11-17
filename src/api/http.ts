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

/**
 * jolpica allows four requests a second and answers 429 beyond that. Opening a
 * comparison dialog fires three calls per picked driver plus a team-mate call,
 * which is over the limit on its own; a gap between request starts keeps any
 * burst inside it. Aborting gives the slot back, so flipping through drivers
 * does not queue up unused waits.
 */
const REQUEST_GAP_MS = 300

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

class StatusError extends Error {
  status: number

  constructor(status: number) {
    // 429 is the one status a reader can act on, so it says what to do instead
    // of quoting the number. The gate above keeps it rare — it means the hourly
    // cap, not the per-second one.
    super(
      status === 429
        ? 'The API is rate limiting requests — try again in a minute.'
        : `Request failed with status ${status}`,
    )
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
 * reason keeps cancellation immediate instead of waiting out the pause.
 */
function pause(millis: number, signal?: AbortSignal): Promise<void> {
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

/** When the last request was allowed to start. */
let lastStart = 0

/** One turn per request, handed out in arrival order. */
let gate: Promise<unknown> = Promise.resolve()

/**
 * Wait for this request's turn in the queue. Measuring the gap from the previous
 * actual start (rather than reserving slots up front) means an aborted caller
 * costs nothing: it never starts, so it never pushes the next one back.
 */
function awaitSlot(signal?: AbortSignal): Promise<void> {
  const turn = gate.then(async () => {
    const wait = lastStart + REQUEST_GAP_MS - Date.now()
    if (wait > 0) await pause(wait, signal)
    lastStart = Date.now()
  })

  gate = turn.catch(() => undefined)
  return turn
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
      await awaitSlot(signal)
      return await requestOnce(url, signal, timeoutMs)
    } catch (cause) {
      if (signal?.aborted || attempt >= attempts || !isRetryable(cause)) throw cause
      await pause(RETRY_DELAY_MS, signal)
    }
  }
}

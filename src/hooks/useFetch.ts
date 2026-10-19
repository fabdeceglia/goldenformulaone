import { useCallback, useEffect, useRef, useState } from 'react'

export type Fetcher<T> = (signal: AbortSignal) => Promise<T>

export interface FetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  /**
   * Fetch again without clearing the current data or showing the loading state.
   * Used for background polls, where replacing the panel with a spinner every
   * minute would be worse than leaving the previous state on screen.
   */
  refresh: () => Promise<void>
}

/**
 * Minimal data-fetching hook: cancels in-flight requests, surfaces errors as
 * plain strings and exposes `reload` for retries and `refresh` for background
 * updates. Pass `null` as the fetcher to stay idle (useful while a required
 * value is still unknown).
 */
export function useFetch<T>(fetcher: Fetcher<T> | null, deps: readonly unknown[]): FetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(fetcher !== null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // The most recent request, whether it came from the effect or a refresh.
  // Starting a new one cancels whichever was in flight.
  const abortRef = useRef<AbortController | null>(null)

  // A refresh is started imperatively, so it is not covered by the effect
  // cleanup below. Abort it when the component goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    const current = fetcherRef.current
    if (!current) {
      abortRef.current?.abort()
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    setData(null)
    setLoading(true)
    setError(null)

    current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setError(cause instanceof Error ? cause.message : 'Something went wrong')
        setLoading(false)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  const refresh = useCallback(async () => {
    const current = fetcherRef.current
    if (!current) return

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    try {
      const result = await current(controller.signal)
      if (controller.signal.aborted) return
      setData(result)
      setLoading(false)
      setError(null)
    } catch (cause: unknown) {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Something went wrong')
      setLoading(false)
    }
  }, [])

  return { data, loading, error, reload, refresh }
}

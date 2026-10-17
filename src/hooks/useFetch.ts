import { useCallback, useEffect, useRef, useState } from 'react'

export type Fetcher<T> = (signal: AbortSignal) => Promise<T>

export interface FetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Minimal data-fetching hook: cancels in-flight requests, surfaces errors as
 * plain strings and exposes a `reload` for retries. Pass `null` as the fetcher
 * to stay idle (useful while a required value is still unknown).
 */
export function useFetch<T>(fetcher: Fetcher<T> | null, deps: readonly unknown[]): FetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(fetcher !== null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const current = fetcherRef.current
    if (!current) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
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

  return { data, loading, error, reload }
}

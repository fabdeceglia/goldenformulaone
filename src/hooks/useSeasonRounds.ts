import { useCallback, useEffect, useRef, useState } from 'react'
import { alpha } from '../api/alpha'
import type { AlphaRound } from '../api/types'
import {
  isRoundsCacheFresh,
  readRoundsCache,
  writeRoundsCache,
} from '../lib/roundsCache'
import type { RoundId } from '../lib/roundsCache'

export type { RoundId }

interface RoundsState {
  season: string
  rounds: RoundId[]
  loading: boolean
  error: string | null
}

export interface SeasonRoundsResult {
  rounds: RoundId[]
  loading: boolean
  error: string | null
  reload: () => void
}

function toRoundIds(items: readonly AlphaRound[]): RoundId[] {
  return items.flatMap((item) =>
    typeof item.number === 'number' ? [{ number: String(item.number), id: item.id }] : [],
  )
}

/**
 * Seeds a season's state from localStorage synchronously, so the very first
 * render already knows the round ids and the results index request can start
 * immediately instead of waiting on `/core/rounds/`.
 */
function initialState(season: string): RoundsState {
  const cached = readRoundsCache(season)
  // An empty mapping cannot resolve any round, so treat it like no cache.
  const usable = cached && cached.rounds.length > 0 ? cached : null
  return {
    season,
    rounds: usable?.rounds ?? [],
    loading: usable === null || !isRoundsCacheFresh(usable),
    error: null,
  }
}

/**
 * Resolves round numbers to alpha round ids for a season.
 *
 * The mapping is cached between visits (see `roundsCache`); it is trusted for
 * `ROUNDS_CACHE_TTL_MS`, after which a background revalidation refreshes it
 * without clearing the rounds already on screen.
 */
export function useSeasonRounds(season: string): SeasonRoundsResult {
  const [state, setState] = useState<RoundsState>(() => initialState(season))
  const [nonce, setNonce] = useState(0)

  // Reloads are imperative, so the effect cannot tell them apart from a season
  // change from the deps alone. This flag makes the next run skip the cache.
  const forceRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Read inside the fetch callbacks, which run after renders the effect has not
  // re-executed for. Synced in an effect so the ref is not written during render.
  const roundsRef = useRef(state.rounds)
  useEffect(() => {
    roundsRef.current = state.rounds
  })

  // Adjust state during render rather than in an effect, so a season change
  // never renders one frame with the previous season's mapping.
  const [renderedSeason, setRenderedSeason] = useState(season)
  if (renderedSeason !== season) {
    setRenderedSeason(season)
    setState(initialState(season))
  }

  useEffect(() => {
    const forced = forceRef.current
    forceRef.current = false

    const cached = readRoundsCache(season)
    const usable = cached && cached.rounds.length > 0 ? cached : null
    const shouldFetch = forced || usable === null || !isRoundsCacheFresh(usable)
    if (!shouldFetch) return

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    setState((previous) =>
      previous.season === season
        ? { ...previous, loading: true, error: null }
        : { season, rounds: usable?.rounds ?? [], loading: true, error: null },
    )

    alpha
      .rounds(season, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        const rounds = toRoundIds(items)
        writeRoundsCache(season, rounds)
        setState((previous) =>
          previous.season === season ? { season, rounds, loading: false, error: null } : previous,
        )
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        // With cached ids on screen the results page still works, so a failed
        // revalidation is only worth a warning; without them it is the error.
        const rounds = roundsRef.current
        if (rounds.length > 0) {
          console.warn(`Round ids for ${season} are stale:`, cause)
        }
        const message = cause instanceof Error ? cause.message : 'Something went wrong'
        setState((previous) =>
          previous.season === season
            ? {
                season,
                rounds,
                loading: false,
                error: rounds.length > 0 ? null : message,
              }
            : previous,
        )
      })

    return () => controller.abort()
  }, [season, nonce])

  const reload = useCallback(() => {
    forceRef.current = true
    abortRef.current?.abort()
    setNonce((value) => value + 1)
  }, [])

  return { rounds: state.rounds, loading: state.loading, error: state.error, reload }
}

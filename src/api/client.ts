import type {
  CircuitResultsResponse,
  ConstructorStandingsResponse,
  DriverStandingsResponse,
  RacesResponse,
} from './types'

/**
 * In development `/ergast` is served by the Vite proxy in `vite.config.ts`.
 * Point `VITE_API_BASE` at the real host to talk to the API directly.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/ergast/f1'

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

export const api = {
  /** The season in progress. The response carries the resolved year. */
  currentRaces: (signal: AbortSignal) => get<RacesResponse>('/current/races/?limit=100', signal),

  driverStandings: (season: string, signal: AbortSignal) =>
    get<DriverStandingsResponse>(`/${season}/driverstandings/?limit=100`, signal),

  constructorStandings: (season: string, signal: AbortSignal) =>
    get<ConstructorStandingsResponse>(`/${season}/constructorstandings/?limit=100`, signal),

  /**
   * Every past winner at a circuit, oldest first — the circuit's history. No
   * circuit has hosted more than 100 races, so one request carries them all.
   */
  circuitWinners: (circuitId: string, signal: AbortSignal) =>
    get<CircuitResultsResponse>(`/circuits/${circuitId}/results/1/?limit=100`, signal),
}

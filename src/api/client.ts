import { getJson } from './http'
import type {
  CircuitResultsResponse,
  ConstructorStandingsResponse,
  DriverQualifyingResponse,
  DriverRaceResultsResponse,
  DriverSprintResultsResponse,
  DriverStandingsResponse,
  RacesResponse,
} from './types'

/**
 * In development `/ergast` is served by the Vite proxy in `vite.config.ts`.
 * Point `VITE_API_BASE` at the real host to talk to the API directly.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/ergast/f1'

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await getJson(`${API_BASE}${path}`, { signal })) as T
}

export const api = {
  /** The season in progress. The response carries the resolved year. */
  currentRaces: (signal: AbortSignal) => get<RacesResponse>('/current/races/?limit=100', signal),

  driverStandings: (season: string, signal: AbortSignal) =>
    get<DriverStandingsResponse>(`/${season}/driverstandings/?limit=100`, signal),

  constructorStandings: (season: string, signal: AbortSignal) =>
    get<ConstructorStandingsResponse>(`/${season}/constructorstandings/?limit=100`, signal),

  /*
   * A driver's season is at most 24 races, so every per-driver endpoint fits in
   * one page under the API's hard `limit` cap of 100.
   */
  driverRaceResults: (season: string, driverId: string, signal: AbortSignal) =>
    get<DriverRaceResultsResponse>(`/${season}/drivers/${driverId}/results/?limit=100`, signal),

  driverSprintResults: (season: string, driverId: string, signal: AbortSignal) =>
    get<DriverSprintResultsResponse>(`/${season}/drivers/${driverId}/sprint/?limit=100`, signal),

  driverQualifying: (season: string, driverId: string, signal: AbortSignal) =>
    get<DriverQualifyingResponse>(`/${season}/drivers/${driverId}/qualifying/?limit=100`, signal),

  /*
   * The constructor-filtered endpoints return both team cars per race, and the
   * payload shape is identical to the per-driver one.
   */
  constructorRaceResults: (season: string, constructorId: string, signal: AbortSignal) =>
    get<DriverRaceResultsResponse>(
      `/${season}/constructors/${constructorId}/results/?limit=100`,
      signal,
    ),

  constructorSprintResults: (season: string, constructorId: string, signal: AbortSignal) =>
    get<DriverSprintResultsResponse>(
      `/${season}/constructors/${constructorId}/sprint/?limit=100`,
      signal,
    ),

  constructorQualifying: (season: string, constructorId: string, signal: AbortSignal) =>
    get<DriverQualifyingResponse>(
      `/${season}/constructors/${constructorId}/qualifying/?limit=100`,
      signal,
    ),

  /**
   * Every past winner at a circuit, oldest first — the circuit's history. No
   * circuit has hosted more than 100 races, so one request carries them all.
   */
  circuitWinners: (circuitId: string, signal: AbortSignal) =>
    get<CircuitResultsResponse>(`/circuits/${circuitId}/results/1/?limit=100`, signal),
}

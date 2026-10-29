/**
 * Worker-wide configuration and upstream constants.
 *
 * The values here are policy, not secrets. Anything secret (a future OpenF1
 * key) belongs in a Wrangler secret and `Env`, never in `wrangler.jsonc`.
 */

export interface Env {
  RESULTS: KVNamespace
  JOLPICA_USER_AGENT?: string
  JOLPICA_BASE?: string
  JOLPICA_RELAY?: string
  OPENF1_BASE?: string
  OPENF1_RELAY?: string
  OPENF1_API_KEY?: string
}

export const DEFAULT_JOLPICA_BASE = 'https://api.jolpi.ca'
export const DEFAULT_OPENF1_BASE = 'https://api.openf1.org/v1'

export const DEFAULT_USER_AGENT =
  'GoldenFormulaOne/1.0.0 (+https://github.com/fabdeceglia/goldenformulaone)'

/** One stalled upstream call is abandoned after this long. */
export const UPSTREAM_TIMEOUT_MS = 5_000

/** An on-demand request must answer within this budget, metadata included. */
export const ON_DEMAND_DEADLINE_MS = 8_000

/** OpenF1 allows 3 requests/second; 500 ms serialises every call below that. */
export const OPENF1_REQUEST_GAP_MS = 500

/** A cron tick refreshes at most this many sessions. */
export const CRON_SESSION_CAP = 4

/** Stop frequent polling once a session is this old. */
export const FREQUENT_POLL_WINDOW_MS = 24 * 60 * 60_000

/** A final result is rechecked at these offsets from its fetch time. */
export const FINAL_RECHECK_OFFSETS_MS = [
  1 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  72 * 60 * 60_000,
] as const

export const PROVISIONAL_RECHECK_MS = 5 * 60_000
export const LOCK_RETRY_MS = 15 * 60_000
export const ERROR_RETRY_MS = 5 * 60_000
export const HEARTBEAT_MS = 10 * 60_000

export const CALENDAR_TTL_MS = 12 * 60 * 60_000
export const ROUNDS_TTL_MS = 12 * 60 * 60_000
export const OPENF1_SESSIONS_TTL_MS = 6 * 60 * 60_000
export const DRIVERS_TTL_MS = 24 * 60 * 60_000

/** A stale-result fallback for a non-final session (on-demand only). */
export const ON_DEMAND_STALE_MS = 24 * 60 * 60_000

export const FALLBACK_EXPECTED_DRIVERS = 20

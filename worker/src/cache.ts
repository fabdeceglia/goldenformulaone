import {
  RESULT_CACHE_VERSION,
  isCachedResult,
  resultSignature,
  type CachedResult,
  type ResultSource,
  type ResultState,
} from '../../src/shared/results'
import { HEARTBEAT_MS, type Env } from './config'

export const keys = {
  calendar: (season: string) => `meta:calendar:${season}`,
  rounds: (season: string) => `meta:rounds:${season}`,
  openf1Sessions: (season: string) => `meta:openf1:sessions:${season}`,
  drivers: (season: string) => `meta:drivers:${season}`,
  status: 'meta:status',
  result: (season: string, round: string, code: string) => `result:${season}:${round}:${code}`,
} as const

export interface MetaEnvelope<T> {
  savedAt: number
  data: T
}

export async function readMeta<T>(env: Env, key: string): Promise<MetaEnvelope<T> | null> {
  try {
    const value = await env.RESULTS.get<MetaEnvelope<T>>(key, { type: 'json', cacheTtl: 60 })
    if (!value || typeof value !== 'object' || typeof value.savedAt !== 'number') return null
    return value
  } catch {
    return null
  }
}

export async function writeMeta<T>(env: Env, key: string, data: T, now: number): Promise<void> {
  const value: MetaEnvelope<T> = { savedAt: now, data }
  try {
    await env.RESULTS.put(key, JSON.stringify(value))
  } catch (cause) {
    // Metadata is a cache. A failed write must not fail the request that just
    // fetched a perfectly good calendar or driver count.
    console.error(
      JSON.stringify({
        event: 'kv.meta.write.error',
        key,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    )
  }
}

export async function readResult(
  env: Env,
  season: string,
  round: string,
  code: string,
): Promise<CachedResult | null> {
  try {
    const value = await env.RESULTS.get(keys.result(season, round, code), {
      type: 'json',
      // Cloudflare's minimum cacheTtl is 60 seconds, which also matches the
      // default KV propagation window the client polls on.
      cacheTtl: 60,
    })
    return isCachedResult(value) ? value : null
  } catch {
    return null
  }
}

/**
 * The single write path for results. It re-reads the key, refuses to replace a
 * higher revision or to downgrade `final`, and skips the write entirely when
 * the durable state is unchanged.
 *
 * KV reads can be stale across regions, so this is best-effort serialization,
 * not a distributed lock. That is acceptable at this traffic level.
 */
export async function writeResultIfNewer(
  env: Env,
  candidate: CachedResult,
  previous: CachedResult | null,
): Promise<CachedResult> {
  const revision = (previous?.revision ?? 0) + 1
  const current = await readResult(env, candidate.season, candidate.round, candidate.code)
  const effective = current ?? previous

  if (current) {
    if (current.revision >= revision) return current
    if (current.state === 'final' && candidate.state !== 'final') return current
  }

  if (effective && resultSignature(effective) === resultSignature(candidate)) {
    return {
      ...candidate,
      v: RESULT_CACHE_VERSION,
      revision: effective.revision,
    }
  }

  const next: CachedResult = {
    ...candidate,
    v: RESULT_CACHE_VERSION,
    revision,
  }
  try {
    await env.RESULTS.put(
      keys.result(candidate.season, candidate.round, candidate.code),
      JSON.stringify(next),
    )
  } catch (cause) {
    // The freshly fetched result is still the best answer for this request;
    // the next cron tick or request can try the write again.
    console.error(
      JSON.stringify({
        event: 'kv.result.write.error',
        season: candidate.season,
        round: candidate.round,
        code: candidate.code,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    )
  }
  return next
}

export interface StatusSession {
  season: string
  round: string
  code: string
  state: ResultState
  source: ResultSource | null
  checkedAt: string
}

export interface StatusBlob {
  lastRunAt: string | null
  lastError: string | null
  sessions: StatusSession[]
}

export async function readStatus(env: Env): Promise<StatusBlob> {
  const value = await readMeta<StatusBlob>(env, keys.status)
  return value?.data ?? { lastRunAt: null, lastError: null, sessions: [] }
}

/**
 * One heartbeat key every ten minutes. Per-session status is not written on
 * every cron tick: a two-minute cron would otherwise use thousands of KV writes
 * a day.
 */
export async function writeStatus(
  env: Env,
  next: StatusBlob,
  now: number,
  force = false,
): Promise<void> {
  if (!force) {
    const previous = await readStatus(env)
    const last = previous.lastRunAt ? Date.parse(previous.lastRunAt) : Number.NaN
    if (
      Number.isFinite(last) &&
      now - last < HEARTBEAT_MS &&
      previous.lastError === next.lastError
    ) {
      return
    }
  }

  await writeMeta(env, keys.status, next, now)
}

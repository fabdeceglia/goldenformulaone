import type { AlphaSessionResults, Race } from '../../src/api/types'
import {
  classificationHash,
  emptySourceStatus,
  type CachedResult,
  type ResultSource,
  type SourceCheck,
  type SourceStatus,
} from '../../src/shared/results'
import { sessionWindows } from '../../src/shared/schedule'
import { readResult, writeResultIfNewer } from './cache'
import {
  CRON_SESSION_CAP,
  ERROR_RETRY_MS,
  FINAL_RECHECK_OFFSETS_MS,
  FREQUENT_POLL_WINDOW_MS,
  LOCK_RETRY_MS,
  PROVISIONAL_RECHECK_MS,
  type Env,
} from './config'
import {
  currentSeason,
  loadCalendar,
  loadExpectedDrivers,
  loadOpenF1Sessions,
  loadRoundIds,
  type SessionTarget,
} from './schedule'
import {
  fetchSessionResult as fetchJolpicaSession,
  type JolpicaSessionResult,
  type SourceOptions,
} from './sources/jolpica'
import {
  fetchSessionResult as fetchOpenF1Session,
  type OpenF1Outcome,
  type OpenF1SessionRow,
} from './sources/openf1'

/** A final result is a candidate for rechecks for a full week after the flag. */
const FINAL_CANDIDATE_WINDOW_MS = 7 * 24 * 60 * 60_000

export interface RefreshContext {
  env: Env
  now: number
  season: string
  races: Race[]
  roundIds: Record<string, string>
  expectedDrivers: number
  options: SourceOptions
  openF1Sessions: Promise<OpenF1SessionRow[]> | null
}

export async function createRefreshContext(
  env: Env,
  now: number,
  deadline?: number,
  season = currentSeason(now),
): Promise<RefreshContext> {
  const options: SourceOptions = deadline === undefined ? { now } : { now, deadline }

  const [races, roundIds, expectedDrivers] = await Promise.all([
    loadCalendar(env, season, options),
    loadRoundIds(env, season, options),
    loadExpectedDrivers(env, season, options),
  ])

  return {
    env,
    now,
    season,
    races,
    roundIds,
    expectedDrivers,
    options,
    openF1Sessions: null,
  }
}

function getOpenF1Sessions(context: RefreshContext): Promise<OpenF1SessionRow[]> {
  if (!context.openF1Sessions) {
    context.openF1Sessions = loadOpenF1Sessions(
      context.env,
      context.season,
      context.options,
    )
  }
  return context.openF1Sessions
}

function iso(now: number): string {
  return new Date(now).toISOString()
}

function openF1Allowed(cached: CachedResult | null, now: number): boolean {
  const retryAt = cached?.sources.openf1.retryAt
  return !retryAt || Date.parse(retryAt) <= now
}

/** Apply the per-source backoff policy and record when it expires. */
function withRetry(check: SourceCheck, now: number): SourceCheck {
  if (check.state === 'locked') {
    return { ...check, retryAt: iso(now + Math.max(check.retryAfterMs ?? 0, LOCK_RETRY_MS)) }
  }
  if (check.state === 'error') {
    return { ...check, retryAt: iso(now + Math.max(check.retryAfterMs ?? 0, ERROR_RETRY_MS)) }
  }
  return check
}

function sameStatus(left: SourceStatus, right: SourceStatus): boolean {
  return (
    left.state === right.state &&
    left.count === right.count &&
    left.complete === right.complete &&
    (left.error ?? '') === (right.error ?? '') &&
    (left.retryAt ?? '') === (right.retryAt ?? '')
  )
}

function mergeSource(
  previous: SourceStatus | undefined,
  check: SourceCheck | undefined,
  nowIso: string,
): SourceStatus {
  if (!check) return previous ?? emptySourceStatus()

  const next: SourceStatus = {
    state: check.state,
    count: check.count,
    complete: check.complete,
    checkedAt: nowIso,
    ...(check.error ? { error: check.error } : {}),
    ...(check.retryAt ? { retryAt: check.retryAt } : {}),
  }

  // Keep the old `checkedAt` when nothing material changed, so the durable
  // record only records transitions rather than every two-minute tick.
  return previous && sameStatus(previous, next) ? previous : next
}

function mergeSources(
  cached: CachedResult | null,
  checks: Partial<Record<ResultSource, SourceCheck>>,
  nowIso: string,
): CachedResult['sources'] {
  return {
    jolpica: mergeSource(cached?.sources.jolpica, checks.jolpica, nowIso),
    openf1: mergeSource(cached?.sources.openf1, checks.openf1, nowIso),
  }
}

function nextRecheckAt(baseIso: string, now: number): string | null {
  const base = Date.parse(baseIso)
  if (!Number.isFinite(base)) return iso(now + FINAL_RECHECK_OFFSETS_MS[0])

  for (const offset of FINAL_RECHECK_OFFSETS_MS) {
    if (base + offset > now + 1_000) return iso(base + offset)
  }
  return null
}

function failedRecheckAt(cached: CachedResult, now: number): string | null {
  const base = cached.fetchedAt ? Date.parse(cached.fetchedAt) : Number.NaN
  const lastOffset = FINAL_RECHECK_OFFSETS_MS[FINAL_RECHECK_OFFSETS_MS.length - 1]
  if (Number.isFinite(base) && now + 60 * 60_000 > base + lastOffset) return null
  return iso(now + 60 * 60_000)
}

function baseResult(
  target: SessionTarget,
  cached: CachedResult | null,
  ctx: RefreshContext,
  fields: {
    state: CachedResult['state']
    source: ResultSource | null
    complete: boolean
    session: AlphaSessionResults | null
    sources: CachedResult['sources']
    nextAttemptAt: string | null
    recheckAt: string | null
  },
): CachedResult {
  const nowIso = iso(ctx.now)
  const sameSession =
    !!cached?.session &&
    !!fields.session &&
    classificationHash(cached.session) === classificationHash(fields.session)

  return {
    v: 2,
    revision: 0,
    season: target.season,
    round: target.round,
    code: target.code,
    state: fields.state,
    source: fields.source,
    complete: fields.complete,
    session: fields.session,
    fetchedAt: fields.session
      ? sameSession
        ? (cached?.fetchedAt ?? nowIso)
        : nowIso
      : null,
    checkedAt: nowIso,
    nextAttemptAt: fields.nextAttemptAt,
    recheckAt: fields.recheckAt,
    sources: fields.sources,
  }
}

function finalCandidate(
  target: SessionTarget,
  session: AlphaSessionResults,
  cached: CachedResult | null,
  ctx: RefreshContext,
  sources: CachedResult['sources'],
): CachedResult {
  const result = baseResult(target, cached, ctx, {
    state: 'final',
    source: 'jolpica',
    complete: true,
    session,
    sources,
    nextAttemptAt: null,
    recheckAt: null,
  })

  return {
    ...result,
    recheckAt: nextRecheckAt(result.fetchedAt ?? iso(ctx.now), ctx.now),
  }
}

function chooseProvisional(
  target: SessionTarget,
  jolpica: JolpicaSessionResult,
  jolpicaCheck: SourceCheck,
  openf1: OpenF1Outcome | null,
  cached: CachedResult | null,
  ctx: RefreshContext,
  sources: CachedResult['sources'],
): CachedResult {
  const jolpicaSession =
    jolpica.check.state === 'ready' && jolpica.session?.results.length ? jolpica.session : null
  const openf1Session =
    openf1?.check.state === 'ready' && openf1.session?.results.length ? openf1.session : null

  if (openf1Session && openf1?.check.complete) {
    return baseResult(target, cached, ctx, {
      state: 'provisional',
      source: 'openf1',
      complete: true,
      session: openf1Session,
      sources,
      nextAttemptAt: iso(ctx.now + PROVISIONAL_RECHECK_MS),
      recheckAt: null,
    })
  }

  if (jolpicaSession && (!openf1Session || jolpica.check.count >= (openf1?.check.count ?? 0))) {
    return baseResult(target, cached, ctx, {
      state: 'provisional',
      source: 'jolpica',
      complete: false,
      session: jolpicaSession,
      sources,
      nextAttemptAt: iso(ctx.now + PROVISIONAL_RECHECK_MS),
      recheckAt: null,
    })
  }

  if (openf1Session) {
    return baseResult(target, cached, ctx, {
      state: 'provisional',
      source: 'openf1',
      complete: false,
      session: openf1Session,
      sources,
      nextAttemptAt: iso(ctx.now + PROVISIONAL_RECHECK_MS),
      recheckAt: null,
    })
  }

  return pendingCandidate(target, cached, ctx, sources, jolpicaCheck)
}

function pendingCandidate(
  target: SessionTarget,
  cached: CachedResult | null,
  ctx: RefreshContext,
  sources: CachedResult['sources'],
  jolpicaCheck?: SourceCheck,
): CachedResult {
  const retryAt = jolpicaCheck?.state === 'error' ? jolpicaCheck.retryAt : undefined

  return baseResult(target, cached, ctx, {
    state: 'pending',
    source: null,
    complete: false,
    session: null,
    sources,
    nextAttemptAt: retryAt ?? null,
    recheckAt: null,
  })
}

function finalRecheckCandidate(
  cached: CachedResult,
  jolpica: JolpicaSessionResult,
  ctx: RefreshContext,
  sources: CachedResult['sources'],
): CachedResult {
  const nowIso = iso(ctx.now)

  if (jolpica.check.complete && jolpica.session) {
    const changed = classificationHash(cached.session) !== classificationHash(jolpica.session)
    const fetchedAt = changed ? nowIso : (cached.fetchedAt ?? nowIso)

    return {
      ...cached,
      state: 'final',
      source: 'jolpica',
      complete: true,
      session: changed ? jolpica.session : cached.session,
      fetchedAt,
      checkedAt: nowIso,
      nextAttemptAt: null,
      recheckAt: nextRecheckAt(fetchedAt, ctx.now),
      sources,
    }
  }

  // A failed or incomplete recheck keeps the canonical table and pushes the
  // next check forward instead of retrying on every tick.
  return {
    ...cached,
    state: 'final',
    complete: true,
    checkedAt: nowIso,
    nextAttemptAt: null,
    recheckAt: failedRecheckAt(cached, ctx.now),
    sources,
  }
}

/**
 * Refresh one session: jolpica first, OpenF1 for every session when jolpica is
 * incomplete, then one guarded write that cannot downgrade a final result.
 */
export async function refreshSession(
  target: SessionTarget,
  ctx: RefreshContext,
): Promise<CachedResult> {
  const cached = await readResult(ctx.env, target.season, target.round, target.code)

  if (
    cached?.state === 'final' &&
    cached.recheckAt !== null &&
    ctx.now < Date.parse(cached.recheckAt)
  ) {
    return cached
  }

  const isFinal = cached?.state === 'final'
  const roundId = ctx.roundIds[target.round] ?? null
  const jolpica = await fetchJolpicaSession(
    roundId,
    target.code,
    ctx.expectedDrivers,
    ctx.env,
    ctx.options,
  )
  const checks: Partial<Record<ResultSource, SourceCheck>> = {}
  const jolpicaCheck = withRetry(jolpica.check, ctx.now)
  checks.jolpica = jolpicaCheck

  let openf1: OpenF1Outcome | null = null
  if (!isFinal && !jolpica.check.complete && openF1Allowed(cached, ctx.now)) {
    const sessions = await getOpenF1Sessions(ctx)
    openf1 = await fetchOpenF1Session(
      target.race,
      target.code,
      sessions,
      ctx.expectedDrivers,
      ctx.env,
      ctx.options,
    )
    checks.openf1 = withRetry(openf1.check, ctx.now)
  }

  const sources = mergeSources(cached, checks, iso(ctx.now))

  if (cached?.state === 'final') {
    return writeResultIfNewer(
      ctx.env,
      finalRecheckCandidate(cached, jolpica, ctx, sources),
      cached,
    )
  }

  if (jolpica.check.complete && jolpica.session) {
    return writeResultIfNewer(
      ctx.env,
      finalCandidate(target, jolpica.session, cached, ctx, sources),
      cached,
    )
  }

  if (
    jolpica.check.state === 'ready' ||
    openf1?.check.state === 'ready' ||
    openf1?.session != null
  ) {
    return writeResultIfNewer(
      ctx.env,
      chooseProvisional(target, jolpica, jolpicaCheck, openf1, cached, ctx, sources),
      cached,
    )
  }

  return writeResultIfNewer(
    ctx.env,
    pendingCandidate(target, cached, ctx, sources, jolpicaCheck),
    cached,
  )
}

/**
 * Sessions a cron tick should consider. Reads are cheap and bounded: only
 * sessions from the last week are candidates, and the batch is rotated by the
 * persisted `checkedAt` so every session gets a turn.
 */
export async function dueSessions(
  ctx: RefreshContext,
  now: number,
): Promise<SessionTarget[]> {
  const items: Array<{ target: SessionTarget; checkedAt: number }> = []

  for (const race of ctx.races) {
    for (const window of sessionWindows(race)) {
      if (now < window.end) continue
      if (now > window.end + FINAL_CANDIDATE_WINDOW_MS) continue

      const cached = await readResult(ctx.env, ctx.season, race.round, window.entry.code)
      const isFinal = cached?.state === 'final'

      if (isFinal) {
        if (cached.recheckAt !== null) {
          if (now < Date.parse(cached.recheckAt)) continue
        } else if (now - Date.parse(cached.checkedAt) < FINAL_RECHECK_OFFSETS_MS[2]) {
          // A final with no recheck schedule is due once, then left alone for
          // the rest of the amendment window.
          continue
        }
      } else if (now > window.end + FREQUENT_POLL_WINDOW_MS) {
        continue
      }

      if (cached?.nextAttemptAt && now < Date.parse(cached.nextAttemptAt)) continue

      items.push({
        target: {
          season: ctx.season,
          round: race.round,
          code: window.entry.code,
          race,
          window,
        },
        checkedAt: cached?.checkedAt ? Date.parse(cached.checkedAt) : 0,
      })
    }
  }

  items.sort((left, right) => left.checkedAt - right.checkedAt)
  return items.slice(0, CRON_SESSION_CAP).map((item) => item.target)
}

export interface RefreshBatch {
  results: CachedResult[]
  errors: string[]
}

/** Run a cron batch without letting one bad session fail the whole tick. */
export async function refreshDueSessions(ctx: RefreshContext, now: number): Promise<RefreshBatch> {
  const targets = await dueSessions(ctx, now)
  const settled = await Promise.allSettled(
    targets.map((target) => refreshSession(target, ctx)),
  )

  const results: CachedResult[] = []
  const errors: string[] = []

  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value)
    } else {
      const target = targets[index]
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      errors.push(`${target.season}/${target.round}/${target.code}: ${message}`)
    }
  })

  return { results, errors }
}

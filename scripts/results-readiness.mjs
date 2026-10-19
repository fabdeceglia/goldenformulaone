#!/usr/bin/env node
/**
 * Measures how long results take to become usable after a session ends, from
 * two sources:
 *
 * - jolpica's alpha results endpoint;
 * - OpenF1's `session_result` endpoint.
 *
 * Neither API exposes when a result was published: jolpica's
 * `metadata.timestamp` is when the response was generated, a session's
 * `timestamp` is its scheduled start, and OpenF1's `session_result` has no
 * timestamp at all. So readiness cannot be reconstructed after the fact. This
 * probe samples both APIs during the window after a session and records the
 * first poll where each result payload is non-empty / complete.
 *
 * Usage:
 *   npm run readiness -- --round 18 --loop
 *   npm run readiness -- --round 18 --session R --source openf1
 *   npm run readiness -- --report
 *
 * The default output is `.readiness/results.jsonl` (git-ignored).
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const API = 'https://api.jolpi.ca'
const OPENF1_API = 'https://api.openf1.org/v1'
const USER_AGENT =
  'GoldenFormulaOne-readiness/1.0.0 (+https://github.com/fabdeceglia/goldenformulaone)'

/** How long a session is assumed to run, matching src/lib/schedule.ts. */
const SESSION_MINUTES = {
  FP1: 60,
  FP2: 60,
  FP3: 60,
  SQ: 30,
  SR: 45,
  Q: 60,
  R: 120,
}

/**
 * Polling cadence after the estimated session end. Early polls are frequent so
 * a one-hour delay can be measured with a useful resolution; later polls back
 * off to stay well inside the API's rate limit.
 */
const POLL_STEPS = [
  { untilMinutes: 10, everyMs: 30_000 },
  { untilMinutes: 30, everyMs: 60_000 },
  { untilMinutes: 120, everyMs: 120_000 },
  { untilMinutes: 360, everyMs: 300_000 },
]

const DEFAULT_OUT = '.readiness/results.jsonl'

function parseArgs(argv) {
  const args = {
    season: String(new Date().getUTCFullYear()),
    round: null,
    session: null,
    source: 'both',
    once: false,
    loop: false,
    report: false,
    force: false,
    out: DEFAULT_OUT,
    lookbackMinutes: 360,
    aheadMinutes: 5,
    timeoutMinutes: 360,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      i += 1
      if (i >= argv.length) throw new Error(`${arg} needs a value`)
      return argv[i]
    }

    switch (arg) {
      case '--season':
        args.season = value()
        break
      case '--round':
        args.round = value()
        break
      case '--session':
        args.session = value().toUpperCase()
        break
      case '--source':
        args.source = value().toLowerCase()
        break
      case '--out':
        args.out = value()
        break
      case '--lookback-minutes':
        args.lookbackMinutes = Number(value())
        break
      case '--ahead-minutes':
        args.aheadMinutes = Number(value())
        break
      case '--timeout-minutes':
        args.timeoutMinutes = Number(value())
        break
      case '--once':
        args.once = true
        break
      case '--loop':
        args.loop = true
        break
      case '--report':
        args.report = true
        break
      case '--force':
        args.force = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!['both', 'jolpica', 'openf1'].includes(args.source)) {
    throw new Error(`--source must be one of both, jolpica, openf1 (got ${args.source})`)
  }

  if (!args.once && !args.loop && !args.report) args.once = true
  return args
}

function printHelp() {
  console.log(`Results readiness probe

  --season <year>          Season to inspect (default: current UTC year)
  --round <number>         Only this round (default: all in the lookback window)
  --session <code>         Only this session: FP1 FP2 FP3 SQ SR Q R
  --source <name>          both (default), jolpica, or openf1
  --once                   Probe once (default when neither --once nor --loop)
  --loop                   Wait for sessions and poll until results arrive
  --report                 Summarise the recorded samples
  --force                  Probe even if the session is outside the window
  --out <path>             JSONL output (default: ${DEFAULT_OUT})
  --lookback-minutes <n>   How far back --once looks (default: 360)
  --ahead-minutes <n>      How far ahead --once looks (default: 5)
  --timeout-minutes <n>    Stop polling this long after session end (default: 360)
`)
}

async function request(path) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })

  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}`)
  }

  const payload = await response.json()
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
}

/**
 * OpenF1 answers 404 with `{ "detail": "No results found." }` until a session's
 * results exist. Treat that as an empty sample, not a failure.
 */
async function requestOpenF1(path) {
  const response = await fetch(`${OPENF1_API}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })

  if (response.status === 404) return []
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}`)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

/** Collapse Q1/Q2/Q3 and SQ1/SQ2/SQ3 into the codes the results endpoint uses. */
function resultCode(type) {
  if (type === 'R' || type === 'SR') return type
  if (type.startsWith('SQ')) return 'SQ'
  if (type.startsWith('Q')) return 'Q'
  return type
}

function sessionStart(session) {
  return Date.parse(session.timestamp)
}

function sessionEnd(session, code) {
  return sessionStart(session) + SESSION_MINUTES[code] * 60_000
}

/** Map OpenF1's session names onto the codes the results endpoints use. */
function openF1Code(sessionName) {
  switch (sessionName.toLowerCase()) {
    case 'practice 1':
      return 'FP1'
    case 'practice 2':
      return 'FP2'
    case 'practice 3':
      return 'FP3'
    case 'sprint qualifying':
    case 'sprint shootout':
      return 'SQ'
    case 'sprint':
      return 'SR'
    case 'qualifying':
      return 'Q'
    case 'race':
      return 'R'
    default:
      return null
  }
}

/**
 * Match a jolpica session to its OpenF1 session. OpenF1's `sessions` endpoint
 * exposes the scheduled start, so the code and timestamp are enough. The
 * twelve-hour tolerance covers a schedule change without risking a different
 * round: the same session code never occurs twice in one weekend.
 */
function matchOpenF1Session(sessions, code, start) {
  let best = null

  for (const session of sessions) {
    if (openF1Code(session.session_name) !== code) continue
    const delta = Math.abs(Date.parse(session.date_start) - start)
    if (delta > 12 * 60 * 60_000) continue
    if (!best || delta < best.delta) best = { session, delta }
  }

  return best?.session ?? null
}

async function loadTargets(args) {
  const rounds = await request(`/f1/alpha/core/rounds/?year=${args.season}`)
  const wanted = args.round === null ? null : String(args.round)
  const targets = []

  let openf1Sessions = []
  if (args.source !== 'jolpica') {
    try {
      openf1Sessions = await requestOpenF1(`/sessions?year=${args.season}`)
    } catch (cause) {
      console.warn(
        `OpenF1 sessions unavailable (${cause instanceof Error ? cause.message : cause}); sampling jolpica only.`,
      )
    }
  }

  for (const round of rounds) {
    if (wanted !== null && String(round.number) !== wanted) continue

    // A round lists Q1/Q2/Q3 separately even though the results endpoint takes
    // one `Q`. Keep the earliest occurrence of each result code.
    const seen = new Set()
    for (const session of round.sessions ?? []) {
      const code = resultCode(session.type)
      if (!(code in SESSION_MINUTES) || seen.has(code)) continue
      seen.add(code)

      const start = sessionStart(session)
      const openf1 = matchOpenF1Session(openf1Sessions, code, start)

      targets.push({
        season: args.season,
        round: round.number,
        roundId: round.id,
        roundName: round.name,
        code,
        start,
        end: sessionEnd(session, code),
        openf1Key: openf1?.session_key ?? null,
        openf1Name: openf1?.session_name ?? null,
      })
    }
  }

  targets.sort((a, b) => a.start - b.start)

  const selected = args.session
    ? targets.filter((target) => target.code === args.session)
    : targets

  if (args.source === 'openf1') {
    const mapped = selected.filter((target) => target.openf1Key != null)
    if (mapped.length === 0 && selected.length > 0) {
      console.warn('No OpenF1 session keys matched the selected jolpica sessions.')
    }
    return mapped
  }

  return selected
}

function inWindow(target, now, args) {
  return (
    target.end >= now - args.lookbackMinutes * 60_000 &&
    target.start <= now + args.aheadMinutes * 60_000
  )
}

async function expectedStarters(season, round, cache) {
  const key = `${season}/${round}`
  if (cache.has(key)) return cache.get(key)

  let expected = null
  try {
    const data = await request(`/ergast/f1/${season}/${round}/drivers/?limit=100`)
    const total = Number(data?.MRData?.total ?? 0)
    if (total > 0) expected = total
  } catch {
    // A future round has no driver list yet. Completeness then falls back to a
    // minimum grid size rather than failing the sample.
  }

  cache.set(key, expected)
  return expected
}

function classify(results, expected) {
  if (results.length === 0) {
    return { state: 'empty', complete: false, count: 0, positioned: 0 }
  }

  const positioned = results.filter(
    (entry) => Number.isFinite(Number(entry.position)) && Number(entry.position) > 0,
  ).length
  const minimum = expected ?? 20

  // Retirements and excluded cars may have no position but still belong to the
  // classification, so the entry count is what makes a payload complete.
  const complete = results.length >= minimum && positioned > 0

  return {
    state: complete ? 'ready' : 'partial',
    complete,
    count: results.length,
    positioned,
  }
}

function baseRecord(source, target, checkedAt) {
  return {
    checked_at: checkedAt.toISOString(),
    source,
    season: Number(target.season),
    round: target.round,
    round_name: target.roundName,
    code: target.code,
    session_start: new Date(target.start).toISOString(),
    session_end: new Date(target.end).toISOString(),
  }
}

async function probeJolpica(target, expectedCache) {
  const checkedAt = new Date()
  const expected = await expectedStarters(target.season, target.round, expectedCache)
  const base = baseRecord('jolpica', target, checkedAt)

  try {
    const payload = await request(`/f1/alpha/results/${target.roundId}/${target.code}/`)
    const results = Array.isArray(payload?.results) ? payload.results : []
    const status = classify(results, expected)

    return {
      ...base,
      state: status.state,
      result_count: status.count,
      positioned_count: status.positioned,
      expected_count: expected,
      complete: status.complete,
    }
  } catch (cause) {
    return {
      ...base,
      state: 'error',
      result_count: 0,
      positioned_count: 0,
      expected_count: expected,
      complete: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

async function probeOpenF1(target, expectedCache) {
  const checkedAt = new Date()
  const expected = await expectedStarters(target.season, target.round, expectedCache)
  const base = {
    ...baseRecord('openf1', target, checkedAt),
    openf1_session_key: target.openf1Key,
  }

  if (target.openf1Key == null) {
    return {
      ...base,
      state: 'unmapped',
      result_count: 0,
      positioned_count: 0,
      expected_count: expected,
      complete: false,
      error: 'No OpenF1 session key',
    }
  }

  try {
    const results = await requestOpenF1(`/session_result?session_key=${target.openf1Key}`)
    const status = classify(results, expected)

    return {
      ...base,
      state: status.state,
      result_count: status.count,
      positioned_count: status.positioned,
      expected_count: expected,
      complete: status.complete,
    }
  } catch (cause) {
    return {
      ...base,
      state: 'error',
      result_count: 0,
      positioned_count: 0,
      expected_count: expected,
      complete: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

async function probeTarget(target, expectedCache, args) {
  const records = []

  if (args.source !== 'openf1') {
    records.push(await probeJolpica(target, expectedCache))
  }
  if (args.source !== 'jolpica' && target.openf1Key != null) {
    records.push(await probeOpenF1(target, expectedCache))
  }

  return records
}

function sourceOf(record) {
  return record.source ?? 'jolpica'
}

function sessionKey(record) {
  return `${sourceOf(record)}/${record.season}/${record.round}/${record.code}`
}

function targetKey(target, source) {
  return `${source}/${target.season}/${target.round}/${target.code}`
}

async function readRecords(path) {
  try {
    const text = await readFile(path, 'utf8')
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (cause) {
    if (cause?.code === 'ENOENT') return []
    throw cause
  }
}

function latestBySession(records) {
  const latest = new Map()
  for (const record of records) {
    const key = sessionKey(record)
    const current = latest.get(key)
    if (!current || record.checked_at > current.checked_at) latest.set(key, record)
  }
  return latest
}

function shouldRecord(previous, next) {
  return (
    !previous ||
    previous.state !== next.state ||
    previous.complete !== next.complete ||
    previous.result_count !== next.result_count ||
    previous.positioned_count !== next.positioned_count
  )
}

async function appendRecord(path, record) {
  await mkdir(dirname(resolve(path)), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8')
}

function toMillis(value) {
  return typeof value === 'number' ? value : Date.parse(value)
}

function minutesBetween(start, end) {
  return (toMillis(end) - toMillis(start)) / 60_000
}

function formatLatency(lower, upper) {
  if (lower === null && upper === null) return '—'
  if (lower === null) return `≤ ${upper.toFixed(0)}m`
  if (upper === null) return `≥ ${lower.toFixed(0)}m`
  if (Math.abs(upper - lower) < 1) return `~${((lower + upper) / 2).toFixed(0)}m`
  return `${lower.toFixed(0)}–${upper.toFixed(0)}m`
}

async function report(path) {
  const records = await readRecords(path)
  if (records.length === 0) {
    console.log(`No samples in ${path}. Run the probe first.`)
    return
  }

  const sessions = new Map()
  for (const record of records) {
    const key = sessionKey(record)
    if (!sessions.has(key)) sessions.set(key, [])
    sessions.get(key).push(record)
  }

  const rows = []
  for (const [, samples] of sessions) {
    samples.sort((a, b) => a.checked_at.localeCompare(b.checked_at))
    const first = samples[0]
    const firstNonEmpty = samples.find((sample) => sample.result_count > 0) ?? null
    const firstComplete = samples.find((sample) => sample.complete) ?? null

    // An empty first sample proves the results were not published at that
    // moment; the next non-empty sample brackets publication. If the very first
    // sample is already non-empty we only have an upper bound.
    const emptyBefore = firstNonEmpty
      ? [...samples]
          .reverse()
          .find(
            (sample) =>
              sample.state === 'empty' && sample.checked_at < firstNonEmpty.checked_at,
          ) ?? null
      : null

    // The probe starts before the estimated end, so clamp the lower bound to
    // zero: a result cannot be published before the session it belongs to.
    const lower = emptyBefore
      ? Math.max(0, minutesBetween(first.session_end, emptyBefore.checked_at))
      : null
    const upper = firstNonEmpty
      ? Math.max(0, minutesBetween(first.session_end, firstNonEmpty.checked_at))
      : null

    rows.push({
      source: sourceOf(first),
      season: first.season,
      round: first.round,
      code: first.code,
      roundName: first.round_name,
      end: first.session_end,
      firstNonEmpty: firstNonEmpty ? formatLatency(lower, upper) : '—',
      firstComplete: firstComplete
        ? formatLatency(
            null,
            Math.max(0, minutesBetween(first.session_end, firstComplete.checked_at)),
          )
        : '—',
      samples: samples.length,
      lower,
      upper,
      note: firstNonEmpty ? (emptyBefore ? 'bounded' : 'upper bound only') : 'not published yet',
    })
  }

  rows.sort((a, b) => a.end.localeCompare(b.end) || a.source.localeCompare(b.source))

  console.log(
    'Source    Round  Sess  First non-empty  First complete  Samples  Session end (UTC)      Observation',
  )
  for (const row of rows) {
    console.log(
      `${row.source.padEnd(9)} ${String(row.round).padEnd(6)} ${row.code.padEnd(5)} ${row.firstNonEmpty.padEnd(16)} ${row.firstComplete.padEnd(15)} ${String(row.samples).padEnd(8)} ${row.end.padEnd(25)} ${row.note}`,
    )
  }

  for (const source of [...new Set(rows.map((row) => row.source))].sort()) {
    const sourceRows = rows.filter((row) => row.source === source)
    const bounded = sourceRows.filter((row) => row.note === 'bounded')
    const withinHour = bounded.filter((row) => row.upper !== null && row.upper <= 60)
    const overHour = bounded.filter((row) => row.lower !== null && row.lower > 60)
    const straddles = bounded.filter(
      (row) =>
        row.lower !== null &&
        row.upper !== null &&
        row.lower <= 60 &&
        row.upper > 60,
    )
    const upperOnly = sourceRows.filter((row) => row.note === 'upper bound only')
    const pending = sourceRows.length - bounded.length - upperOnly.length

    console.log(
      `\n${source}: ${sourceRows.length} session(s): ${bounded.length} bracketed, ${upperOnly.length} upper bound only, ${pending} pending.`,
    )
    if (bounded.length > 0) {
      console.log(
        `Bracketed sessions: ${withinHour.length} published within 1h, ${overHour.length} after 1h${straddles.length ? `, ${straddles.length} crossing the 1h mark` : ''}.`,
      )
    }
    if (upperOnly.length > 0) {
      console.log(
        'Upper-bound rows started after the results were already present; rerun the probe before the session ends for a precise figure.',
      )
    }
  }

  const bySession = new Map()
  for (const row of rows) {
    const key = `${row.season}/${row.round}/${row.code}`
    if (!bySession.has(key)) bySession.set(key, {})
    bySession.get(key)[row.source] = row
  }

  const comparisons = []
  for (const [key, pair] of bySession) {
    if (pair.jolpica?.upper == null || pair.openf1?.upper == null) continue
    comparisons.push({ key, jolpica: pair.jolpica, openf1: pair.openf1 })
  }

  if (comparisons.length > 0) {
    comparisons.sort((a, b) => a.jolpica.end.localeCompare(b.jolpica.end))
    console.log('\nOpenF1 vs jolpica (first non-empty, minutes after estimated session end):')
    for (const { key, jolpica, openf1 } of comparisons) {
      const [season, round, code] = key.split('/')
      const delta = openf1.upper - jolpica.upper
      const direction =
        Math.abs(delta) < 0.5
          ? 'same time'
          : delta < 0
            ? `OpenF1 ${Math.abs(delta).toFixed(0)}m earlier`
            : `OpenF1 ${delta.toFixed(0)}m later`
      const approximate =
        jolpica.note === 'upper bound only' || openf1.note === 'upper bound only'
          ? ' (upper bound)'
          : ''
      console.log(
        `  ${season} R${round} ${code}: ${direction}${approximate} — jolpica ${jolpica.firstNonEmpty}, OpenF1 ${openf1.firstNonEmpty}`,
      )
    }
  }
}

function nextPollDelay(target, now) {
  const minutesAfterEnd = (now - target.end) / 60_000
  const step = POLL_STEPS.find((candidate) => minutesAfterEnd < candidate.untilMinutes)
  return step?.everyMs ?? null
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function runLoop(targets, args) {
  const now = Date.now()
  const records = await readRecords(args.out)
  const latest = latestBySession(records)
  const expectedCache = new Map()

  const pending = targets.filter((target) => {
    if (target.end + args.timeoutMinutes * 60_000 <= now) return false

    const jolpicaDone =
      args.source === 'openf1' || latest.get(targetKey(target, 'jolpica'))?.complete === true
    const openf1Done =
      args.source === 'jolpica' ||
      target.openf1Key == null ||
      latest.get(targetKey(target, 'openf1'))?.complete === true

    return !(jolpicaDone && openf1Done)
  })

  if (pending.length === 0) {
    console.log('Nothing to watch: every selected session is already complete or too old.')
    return
  }

  console.log(`Watching ${pending.length} session(s). Samples go to ${args.out}`)

  for (const target of pending) {
    const label = `${target.season} R${target.round} ${target.code}`
    const startAt = target.end - 5 * 60_000

    if (Date.now() < startAt) {
      const wait = startAt - Date.now()
      console.log(`${label}: waiting ${(wait / 60_000).toFixed(1)} min for the session to end…`)
      await sleep(wait)
    }

    if (args.source !== 'jolpica' && target.openf1Key == null) {
      console.log(`${label}: no OpenF1 session key; sampling jolpica only`)
    }

    let jolpica = latest.get(targetKey(target, 'jolpica'))
    let openf1 = latest.get(targetKey(target, 'openf1'))

    while (Date.now() < target.end + args.timeoutMinutes * 60_000) {
      if (args.source !== 'openf1' && !jolpica?.complete) {
        const record = await probeJolpica(target, expectedCache)
        if (shouldRecord(jolpica, record)) {
          await appendRecord(args.out, record)
          logRecord(label, record)
        }
        jolpica = record
      }

      if (args.source !== 'jolpica' && target.openf1Key != null && !openf1?.complete) {
        const record = await probeOpenF1(target, expectedCache)
        if (shouldRecord(openf1, record)) {
          await appendRecord(args.out, record)
          logRecord(label, record)
        }
        openf1 = record
      }

      const jolpicaDone = args.source === 'openf1' || jolpica?.complete === true
      const openf1Done =
        args.source === 'jolpica' || target.openf1Key == null || openf1?.complete === true
      if (jolpicaDone && openf1Done) break

      const delay = nextPollDelay(target, Date.now())
      if (delay === null) break
      await sleep(delay)
    }
  }
}

function logRecord(label, record) {
  console.log(
    `${label} ${record.source}: ${record.state} (${record.result_count}/${record.expected_count ?? '?'} results, ${latencyLabel(record)})`,
  )
}

function latencyLabel(record) {
  const minutes = minutesBetween(record.session_end, record.checked_at)
  return minutes < 0
    ? `${Math.abs(minutes).toFixed(1)} min before estimated end`
    : `${minutes.toFixed(1)} min after estimated end`
}

async function runOnce(targets, args) {
  const now = Date.now()
  const selected = targets.filter((target) => args.force || inWindow(target, now, args))

  if (selected.length === 0) {
    console.log('No sessions in the window. Use --round/--session/--force to probe anyway.')
    return
  }

  const records = await readRecords(args.out)
  const latest = latestBySession(records)
  const expectedCache = new Map()

  for (const target of selected) {
    const probed = await probeTarget(target, expectedCache, args)

    if (probed.length === 0) {
      console.log(`${target.season} R${target.round} ${target.code}: no source available`)
      continue
    }

    for (const record of probed) {
      const previous = latest.get(targetKey(target, record.source))

      if (shouldRecord(previous, record)) {
        await appendRecord(args.out, record)
      }

      const suffix = previous ? '' : ' (first observation)'
      console.log(
        `${target.season} R${target.round} ${target.code} ${record.source}: ${record.state} · ${record.result_count}/${record.expected_count ?? '?'} results · ${latencyLabel(record)}${suffix}`,
      )
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.report) {
    await report(args.out)
    return
  }

  const targets = await loadTargets(args)
  if (targets.length === 0) {
    console.log('No matching sessions found.')
    return
  }

  if (args.loop) await runLoop(targets, args)
  else await runOnce(targets, args)
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exitCode = 1
})

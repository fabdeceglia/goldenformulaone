#!/usr/bin/env node
/**
 * Watches what visitors actually see for one round, through the deployed
 * Worker, and prints a line only when a session changes state.
 *
 * `results-readiness.mjs` measures upstream publication by calling jolpica and
 * OpenF1 directly. This script measures the served result: the KV cache, the
 * cron heartbeat and the promotion from provisional to final. During a race
 * weekend, run it in one terminal and `npm run worker:tail` in another.
 *
 * Usage:
 *   npm run results:watch -- --round 19
 *   npm run results:watch -- --round 19 --once
 *   npm run results:watch -- --round 19 --interval 30
 */

const SESSION_CODES = ['FP1', 'FP2', 'FP3', 'SQ', 'SR', 'Q', 'R']
const DEFAULT_BASE = 'https://boxthislap.vercel.app'

function args() {
  const parsed = { season: '2026', round: null, base: DEFAULT_BASE, interval: 60, once: false }
  const argv = process.argv.slice(2)

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--season') [parsed.season, index] = [value, index + 1]
    else if (flag === '--round') [parsed.round, index] = [value, index + 1]
    else if (flag === '--base') [parsed.base, index] = [value, index + 1]
    else if (flag === '--interval') [parsed.interval, index] = [Number(value), index + 1]
    else if (flag === '--once') parsed.once = true
    else if (flag === '--help' || flag === '-h') {
      console.log('Usage: npm run results:watch -- --round 19 [--once] [--interval 60]')
      process.exit(0)
    }
  }

  if (!parsed.round) {
    console.error('Missing --round <number>')
    process.exit(1)
  }
  return parsed
}

const clock = () => new Date().toISOString().slice(11, 19)

async function getJson(url, timeoutMs = 30_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function describe(result) {
  const rows = result.session?.results?.length ?? 0
  return `${result.state}/${result.source ?? '-'} rows=${rows} complete=${result.complete}`
}

let polls = 0

async function poll(config, previous) {
  polls += 1
  const base = config.base.replace(/\/+$/, '')
  const next = new Map()

  for (const code of SESSION_CODES) {
    const result = await getJson(`${base}/api/results/${config.season}/${config.round}/${code}`)
    if (!result) continue

    next.set(code, result)
    const before = previous.get(code)
    const key = `${result.state}/${result.source ?? '-'}`
    const changed = !before || before.key !== key

    if (changed) {
      const arrow = before ? `${before.key} -> ` : ''
      console.log(`${clock()} r${config.round} ${code.padEnd(3)} ${arrow}${describe(result)}`)
    }
  }

  if (next.size === 0) {
    console.log(`${clock()} r${config.round} no sessions known yet (404 for every code)`)
    return next
  }

  let status = null
  try {
    status = await getJson(`${base}/api/status`)
  } catch (cause) {
    console.log(`${clock()} /api/status unavailable: ${cause.message}`)
  }

  // The heartbeat only moves every ten minutes, so log it every fifth poll
  // instead of on every pass.
  if (status && (polls === 1 || polls % 5 === 0)) {
    const heartbeat = status.lastRunAt
      ? `${Math.round((Date.now() - Date.parse(status.lastRunAt)) / 1000)}s ago`
      : 'never'
    const error = status.lastError ? ` error=${status.lastError}` : ''
    console.log(`${clock()} heartbeat ${heartbeat}${error}`)
  }

  const states = new Map()
  for (const [code, result] of next) states.set(code, { key: `${result.state}/${result.source ?? '-'}`, result })
  return states
}

async function main() {
  const config = args()
  console.log(`watching ${config.base} round ${config.round}, every ${config.interval}s`)

  let previous = new Map()
  for (;;) {
    try {
      previous = await poll(config, previous)
    } catch (cause) {
      console.error(`${clock()} poll failed: ${cause.message}`)
    }
    if (config.once) return
    await new Promise((resolve) => setTimeout(resolve, config.interval * 1000))
  }
}

main()

#!/usr/bin/env node

/**
 * Builds the static replay assets the app prefers at runtime.
 *
 * For every finished race/sprint of a season this fetches the field once,
 * downsamples the location feed to 2 Hz, quantises metres, and writes one
 * compact file to public/replays/{session_key}.json. The circuit outline is
 * embedded in the file and also collected in public/circuits.json.
 *
 * Usage:
 *   node scripts/build-replays.mjs --latest 3
 *   node scripts/build-replays.mjs --session 11388
 *   node scripts/build-replays.mjs --season 2026 --force
 *
 * Free-tier OpenF1 is limited to 30 requests a minute, so requests are spaced
 * two seconds apart. A full race is about 26 requests (~50 s); the first run of
 * a season takes a while. Raw responses are cached under .cache/ (git-ignored),
 * so a re-run after a failure does not download the same four megabytes again.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const OPENF1 = 'https://api.openf1.org/v1'
const MULTIVIEWER = 'https://api.multiviewer.app/api/v1'
const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'replays')
const INDEX_FILE = path.join(OUT_DIR, 'index.json')
const CIRCUITS_FILE = path.join(ROOT, 'public', 'circuits.json')
const CACHE_DIR = path.join(ROOT, '.cache', 'openf1')

const SESSION_SLACK_MS = 90 * 60_000
const FREE_TIER_DELAY_MS = 2_100

const options = parseArgs(process.argv.slice(2))

function parseArgs(argv) {
  const parsed = {
    season: String(new Date().getUTCFullYear()),
    latest: null,
    session: null,
    force: false,
    dryRun: false,
    help: false,
    hz: 2,
    gap: FREE_TIER_DELAY_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case '--season':
        parsed.season = String(argv[++index])
        break
      case '--latest':
        parsed.latest = Number(argv[++index])
        break
      case '--session':
        parsed.session = Number(argv[++index])
        break
      case '--force':
        parsed.force = true
        break
      case '--dry-run':
        parsed.dryRun = true
        break
      case '--hz':
        parsed.hz = Number(argv[++index])
        break
      case '--gap':
        parsed.gap = Number(argv[++index])
        break
      case '--help':
      case '-h':
        parsed.help = true
        break
      default:
        throw new Error(`Unknown argument: ${argument}`)
    }
  }

  return parsed
}

function printHelp() {
  console.log(`Usage: node scripts/build-replays.mjs [options]

  --season <year>   Season to bake (default: current UTC year)
  --latest <n>      Only the n most recent finished sessions
  --session <key>   Bake one OpenF1 session_key
  --force           Overwrite existing replay files
  --dry-run         List what would be baked, without fetching anything else
  --hz <n>          Location samples per second (default: 2)
  --gap <ms>        Delay between OpenF1 requests (default: 2100)
  -h, --help        Show this help`)
}

const sleep = (millis) => new Promise((resolve) => setTimeout(resolve, millis))

let nextRequestAt = 0

async function readCache(key) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeCache(key, data) {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data))
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url)
  if (response.status === 429 && attempt < 4) {
    await sleep(5_000 * (attempt + 1))
    return fetchJson(url, attempt + 1)
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} — ${url}`)
  }
  return response.json()
}

/** One throttled request, cached by key so a re-run is cheap. */
async function request(url, cacheKey) {
  if (cacheKey) {
    const cached = await readCache(cacheKey)
    if (cached) return cached
  }

  const now = Date.now()
  const wait = Math.max(0, nextRequestAt - now)
  nextRequestAt = Math.max(now, nextRequestAt) + options.gap
  if (wait > 0) await sleep(wait)

  const data = await fetchJson(url)
  if (cacheKey) await writeCache(cacheKey, data)
  return data
}

/* ---------- The compact sample encoding (mirrors src/lib/replay.ts) ---------- */

const base36 = (value) => Math.max(0, Math.round(value)).toString(36)
const zigzag = (value) => (value < 0 ? -value * 2 - 1 : value * 2)

function encodeLocations(samples, start) {
  let previousT = start
  let previousX = 0
  let previousY = 0
  const frames = []

  for (const sample of samples) {
    const dt = Math.round((sample.t - previousT) / 100)
    const x = Math.round(sample.x)
    const y = Math.round(sample.y)
    const dx = x - previousX
    const dy = y - previousY

    frames.push(`${base36(dt)}.${base36(zigzag(dx))}.${base36(zigzag(dy))}`)
    previousT = sample.t
    previousX = x
    previousY = y
  }

  return frames.join(',')
}

function encodePositions(rows, start) {
  let previousT = start
  const frames = []

  for (const row of rows) {
    const dt = Math.round((row.t - previousT) / 100)
    frames.push(`${base36(dt)}.${base36(row.position)}`)
    previousT = row.t
  }

  return frames.join(',')
}

function usableLocations(rows, start, end) {
  const samples = []
  for (const row of rows) {
    const t = Date.parse(row.date)
    if (!Number.isFinite(t) || t < start || t > end) continue
    if (row.x === 0 && row.y === 0) continue
    samples.push({ t, x: row.x, y: row.y })
  }
  samples.sort((a, b) => a.t - b.t)
  return samples
}

function replayWindow(driverSamples) {
  const starts = driverSamples
    .map((entry) => entry.samples[0]?.t)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
  const ends = driverSamples
    .map((entry) => entry.samples[entry.samples.length - 1]?.t)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)

  if (starts.length === 0 || ends.length === 0) return null

  const start = starts[Math.floor((starts.length - 1) * 0.9)] ?? starts[0]
  const end = ends[ends.length - 1]
  return end > start ? { start, end } : null
}

/**
 * A racing-line outline from one car's first lap, for circuits with no
 * published geometry (Madring returns 404 from Multiviewer). Mirrors
 * `traceOutline` in src/lib/replay.ts.
 */
function traceOutline(driverSamples, start, duration = 200_000) {
  const inWindow = driverSamples
    .map(({ samples }) =>
      samples.filter((sample) => sample.t >= start && sample.t <= start + duration),
    )
    .filter((samples) => samples.length > 20)
    .sort((a, b) => b.length - a.length)

  const samples = inWindow[0]
  if (!samples) return []

  const first = samples[0]
  let cut = samples.length
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    if (sample.t - first.t < 60_000) continue
    if (Math.hypot(sample.x - first.x, sample.y - first.y) < 80) {
      cut = index + 1
      break
    }
  }

  const points = []
  let lastX = Number.NaN
  let lastY = Number.NaN
  for (const sample of samples.slice(0, cut)) {
    if (!Number.isNaN(lastX) && Math.hypot(sample.x - lastX, sample.y - lastY) < 25) continue
    points.push([Math.round(sample.x), Math.round(sample.y)])
    lastX = sample.x
    lastY = sample.y
  }

  return points
}

function downsample(samples, hz) {
  if (samples.length <= 2) return [...samples]

  const interval = 1_000 / hz
  const kept = [samples[0]]
  let lastKept = samples[0].t

  for (let index = 1; index < samples.length - 1; index += 1) {
    if (samples[index].t - lastKept >= interval) {
      kept.push(samples[index])
      lastKept = samples[index].t
    }
  }

  const last = samples[samples.length - 1]
  if (kept[kept.length - 1].t !== last.t) kept.push(last)
  return kept
}

/* ---------- Files ---------- */

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function readCircuits() {
  try {
    return JSON.parse(await fs.readFile(CIRCUITS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * The index lets the app map a jolpica round to its baked file without asking
 * OpenF1 which session it is. Without it a baked replay still needs one
 * `/sessions` request before it can even find the local asset.
 */
async function readIndex() {
  try {
    const parsed = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'))
    return Array.isArray(parsed.sessions) ? parsed.sessions : []
  } catch {
    return []
  }
}

const replayCode = (session) => (session.session_name === 'Sprint' ? 'SR' : 'R')
const indexEntry = (session) => ({
  season: Number(session.year),
  code: replayCode(session),
  date: session.date_start.slice(0, 10),
  sessionKey: session.session_key,
})

function bytes(value) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

/* ---------- Main ---------- */

async function main() {
  if (options.help) {
    printHelp()
    return
  }

  await fs.mkdir(OUT_DIR, { recursive: true })

  console.log(`Fetching the ${options.season} calendar from OpenF1…`)
  const sessions = await request(
    `${OPENF1}/sessions?year=${options.season}`,
    `sessions-${options.season}`,
  )

  const now = Date.now()
  const freeTierWindow = 30 * 60_000 // historical data opens after the flag + 30 min
  let races = sessions
    .filter(
      (session) =>
        (session.session_name === 'Race' || session.session_name === 'Sprint') &&
        !session.is_cancelled &&
        Date.parse(session.date_end) + freeTierWindow <= now,
    )
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))

  if (options.session) {
    races = sessions.filter((session) => session.session_key === options.session)
    if (races.length === 0) {
      console.error(`Session ${options.session} is not in the ${options.season} calendar.`)
      process.exitCode = 1
      return
    }
  }

  if (options.latest) races = races.slice(-options.latest)

  if (races.length === 0) {
    console.log('No finished races to bake.')
    return
  }

  console.log(`\n${races.length} session${races.length === 1 ? '' : 's'} to bake:`)
  for (const race of races) {
    console.log(
      `  ${race.date_start.slice(0, 10)}  ${race.session_name.padEnd(6)} ${race.location}  (${race.session_key})`,
    )
  }

  if (options.dryRun) return

  const circuits = await readCircuits()
  const index = new Map((await readIndex()).map((entry) => [String(entry.sessionKey), entry]))
  let failures = 0

  for (const session of races) {
    const key = session.session_key
    const outputFile = path.join(OUT_DIR, `${key}.json`)

    if (!options.force && (await exists(outputFile))) {
      index.set(String(key), indexEntry(session))
      console.log(`\n${key} ${session.location} — already baked, skipping (use --force to redo)`)
      continue
    }

    console.log(
      `\n${key} ${session.year} ${session.session_name} ${session.location} — fetching…`,
    )

    try {
      const [drivers, positionRows] = await Promise.all([
        request(`${OPENF1}/drivers?session_key=${key}`, `drivers-${key}`),
        request(`${OPENF1}/position?session_key=${key}`, `positions-${key}`),
      ])

      // Geometry is published per circuit, not per session, and a new circuit
      // can be on the calendar before Multiviewer has a layout for it. Treat it
      // as optional: the cars are enough to trace a line if it is missing.
      let info = null
      try {
        info = await request(
          `${MULTIVIEWER}/circuits/${session.circuit_key}/${session.year}`,
          `circuit-${session.circuit_key}-${session.year}`,
        )
      } catch (cause) {
        console.warn(
          `\n  circuit ${session.circuit_key}: ${cause instanceof Error ? cause.message : cause}`,
        )
      }

      // The metadata gives a scheduled slot, not a guaranteed on-track window.
      // Looking 90 minutes either side catches a race that ran early (Singapore
      // did) without picking up the previous day's stray garage row.
      const sessionStart = Date.parse(session.date_start)
      const sessionEnd = Date.parse(session.date_end)
      const fetchStart = Number.isFinite(sessionStart)
        ? sessionStart - SESSION_SLACK_MS
        : now - 24 * 3_600_000
      const fetchEnd = Number.isFinite(sessionEnd) ? sessionEnd + SESSION_SLACK_MS : now

      const driverSamples = []
      let missing = 0

      for (let index = 0; index < drivers.length; index += 1) {
        const driver = drivers[index]
        process.stdout.write(
          `\r  cars ${String(index + 1).padStart(2)}/${drivers.length}  ${driver.name_acronym.padEnd(4)}`,
        )

        try {
          const rows = await request(
            `${OPENF1}/location?session_key=${key}&driver_number=${driver.driver_number}`,
            `locations-${key}-${driver.driver_number}`,
          )
          const samples = downsample(usableLocations(rows, fetchStart, fetchEnd), options.hz)

          if (samples.length < 2) {
            missing += 1
            continue
          }

          driverSamples.push({ driver, samples })
        } catch (cause) {
          missing += 1
          console.warn(`\n  ${driver.name_acronym}: ${cause instanceof Error ? cause.message : cause}`)
        }
      }

      process.stdout.write('\n')

      if (driverSamples.length === 0) {
        throw new Error('no car positions were available')
      }

      // Start when the field is running, not when the earliest outlier moves:
      // a pit-lane car or a delayed starter can be minutes ahead of the pack.
      const window = replayWindow(driverSamples)
      if (!window) throw new Error('no usable replay window')
      const { start, end } = window

      const outline = info
        ? info.x.map((x, index) => [Math.round(x), Math.round(info.y[index])])
        : traceOutline(driverSamples, start)

      if (outline.length < 3) throw new Error('no circuit geometry was available')

      const circuit = {
        circuitKey: session.circuit_key,
        name: info?.circuitName ?? session.circuit_short_name,
        rotation: info?.rotation ?? 0,
        outline,
        approximate: info ? undefined : true,
      }

      // Only publish surveyed geometry in the shared file; a traced line is
      // specific to the race it came from.
      if (info) circuits[String(session.circuit_key)] = { ...circuit, year: session.year }

      const bakedDrivers = driverSamples.map(({ driver, samples }) => ({
        n: driver.driver_number,
        a: driver.name_acronym,
        name: driver.full_name,
        team: driver.team_name,
        c: driver.team_colour ?? undefined,
        s: encodeLocations(samples, start),
      }))

      // Keep the position records from before the replay start: the latest one
      // at `start` is the opening order, even across a formation lap.
      const positionByDriver = new Map()
      for (const row of positionRows) {
        const t = Date.parse(row.date)
        if (!Number.isFinite(t) || t < fetchStart || t > fetchEnd) continue
        if (!Number.isFinite(row.position) || row.position < 1) continue

        let list = positionByDriver.get(row.driver_number)
        if (!list) {
          list = []
          positionByDriver.set(row.driver_number, list)
        }
        list.push({ t, position: row.position })
      }

      const bakedPositions = []
      for (const [number, rows] of positionByDriver) {
        rows.sort((a, b) => a.t - b.t)
        bakedPositions.push({ n: number, s: encodePositions(rows, start) })
      }

      if (bakedDrivers.length === 0) {
        throw new Error('no car positions were available')
      }

      const baked = {
        v: 1,
        sessionKey: key,
        title:
          info?.meetingName ?? info?.meetingOfficialName ?? `${session.location} Grand Prix`,
        subtitle: `${info?.circuitName ?? session.circuit_short_name} · ${session.year} ${
          session.session_name === 'Sprint' ? 'Sprint' : 'Race'
        }`,
        circuit,
        start,
        end,
        drivers: bakedDrivers,
        positions: bakedPositions,
      }

      const json = JSON.stringify(baked)
      await fs.writeFile(outputFile, json)
      index.set(String(key), indexEntry(session))

      console.log(
        `  wrote ${path.relative(ROOT, outputFile)} — ${bytes(Buffer.byteLength(json))}, ` +
          `${bakedDrivers.length} cars${missing ? `, ${missing} missing` : ''}`,
      )
    } catch (cause) {
      failures += 1
      console.error(`  failed: ${cause instanceof Error ? cause.message : cause}`)
    }
  }

  // Only advertise files that are actually on disk, and keep entries from
  // earlier seasons when baking a later one.
  const bakedFiles = new Set(await fs.readdir(OUT_DIR))
  const indexSessions = [...index.values()]
    .filter((entry) => bakedFiles.has(`${entry.sessionKey}.json`))
    .sort(
      (a, b) =>
        a.season - b.season || a.date.localeCompare(b.date) || a.code.localeCompare(b.code),
    )

  await fs.writeFile(INDEX_FILE, JSON.stringify({ v: 1, sessions: indexSessions }))
  await fs.writeFile(CIRCUITS_FILE, JSON.stringify(circuits))
  console.log(`\nWrote ${path.relative(ROOT, INDEX_FILE)} (${indexSessions.length} sessions)`)
  console.log(`Wrote ${path.relative(ROOT, CIRCUITS_FILE)} (${Object.keys(circuits).length} circuits)`)

  if (failures > 0) {
    console.error(`\n${failures} session${failures === 1 ? '' : 's'} failed.`)
    process.exitCode = 1
  }
}

main().catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})

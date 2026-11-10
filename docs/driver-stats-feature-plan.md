# Driver Season Stats — Feature Plan

> Status: **implemented** (2026-11-08). See §14 for what shipped and which open
> questions were answered.
> Owner: Fabrizio · Created: 2026-11-08
> Folder note: `docs/` sits outside the Vite build, so this document is
> version-controlled but **never shipped** in `dist/`.

---

## 1. Goal

Add a per-driver statistics dialog to the **Drivers** section.

- Each row of the driver championship table gets a small chart **icon button**.
- The icon opens a wide modal with two chart tabs and a stats sidebar:
  1. **Points** — cumulative championship points after each event.
  2. **Finish position** — the driver's race classification after each event.
- The sidebar shows (v1): victories, retirements, average race position,
  average qualifying position, plus a small footnote for DNS/DSQ when present.

No new dependency, no Worker change, no new proxy path: the data comes from the
same Ergast-compatible `/ergast/f1/...` family the standings already use.

---

## 2. Why this is feasible (evidence gathered)

Measured against live jolpica on **2026-11-08**, 2026 season (standings table
says round 20; see the freshness note below).

| Endpoint (browser path `/ergast/f1/...`) | Rows for one driver | Size | Time |
| --- | ---: | ---: | ---: |
| `/{season}/drivers/{driverId}/results/?limit=100` | 19 races | ~19 KB | 0.26 s |
| `/{season}/drivers/{driverId}/sprint/?limit=100` | 6 sprints | ~6 KB | 0.28 s |
| `/{season}/drivers/{driverId}/qualifying/?limit=100` | 20 rounds | ~18 KB | 0.30 s |

All three fit in a single page: a season is at most 24 races, well under the
API's hard `limit` cap of 100. **No pagination is needed**, unlike the
season-wide endpoints (see §3.2).

### 2.1 Fields present

Race / sprint result row:

```ts
{
  number: string
  position: string        // always numeric, including retirements
  positionText: string    // "1"…"22", "R" retired, "D" disqualified, "W" did not start
  points: string          // "25", "0", …
  grid: string
  laps: string
  status: string          // "Finished", "Lapped", "Retired", "Did not start", "Disqualified"
  Driver: Driver
  Constructor: Constructor
  Time?: { millis?: string; time?: string }
  FastestLap?: { rank?: string; lap?: string; Time?: { time?: string } }
}
```

Qualifying row:

```ts
{
  number: string
  position: string        // 1…22, never null in the 435 rows sampled
  Driver: Driver
  Constructor: Constructor
  Q1?: string; Q2?: string; Q3?: string   // "1:18.934"
}
```

### 2.2 Facts that shape the design

| Claim | Evidence |
| --- | --- |
| A driver's whole season is 3 requests and no paging | max 24 races < `limit=100`; measured 19/6/20 rows |
| Cumulative points must add **sprint** points | For **all 25** 2026 drivers, standings points == `Σ race points + Σ sprint points` (exact match; e.g. Antonelli 349 + 31 = 380) |
| Retirements still carry a numeric position | Round 3: Stroll `position=21 / positionText=R`; Bearman `22 / R` |
| Non-finishes are distinguishable without parsing `status` | `positionText` is `R` (retired), `D` (disqualified), `W` (did not start), numeric otherwise |
| Status strings vary by season | 2026: Finished 215, Lapped 117, Retired 79, Did not start 7. 2025 adds Disqualified 6. Do **not** hard-code a status list |
| Qualifying has no `positionText` | 435 rows, all with a numeric `position`; use the number directly |
| Data freshness differs per endpoint | On 2026-11-08 race results covered rounds 1–19, qualifying covered 1–20, and the standings object said `round: 20` while its points matched results through 19 |

Consequence of the last row: each chart derives its own x domain from its own
dataset. Do not assume "standings round" means the race-results endpoint has
caught up. Show the coverage ("through round N") in the dialog subtitle.

---

## 3. Data source decision

### 3.1 Chosen: per-driver endpoints (3 small requests)

`/ergast/f1/{season}/drivers/{driverId}/{results|sprint|qualifying}/?limit=100`

- Exactly what the dialog needs, ~40 KB and ~0.3 s in parallel.
- Joins on `driverId`, the same id used by the standings table.
- Cached after the first open, so reopening any driver is instant.

### 3.2 Alternatives rejected

| Option | Why not |
| --- | --- |
| Season-wide `/results/`, `/qualifying/`, `/sprint/` | 418 / 435 / 132 rows, `limit` is hard-capped at 100, and races are **split across pages** (offset 300 returned 8 rows of round 14 and the first 4 of round 19). Needs a paginating loader with per-round merging: ~12 requests for data we then filter to one driver |
| Worker `/api/results/{season}/{round}/{code}` | One request per session per round (~40 for R+Q), no batch route, alpha rows keyed by car number rather than `driverId`, and only in-window sessions are guaranteed. The Worker is the canonical path for **session result tables**; charts are not that |
| Per-round standings `/…/{round}/driverstandings/` | 20 requests and only gives the selected driver's total per round, not positions or qualifying |

The new calls live under the existing `/ergast/f1` prefix, so `vite.config.ts`
and production configuration need **no change**.

---

## 4. Data model and derivation

### 4.1 New wire types (`src/api/types.ts`)

Reuse the existing `Race`, `Driver`, `Constructor` interfaces.

```ts
export interface RaceResult {
  number: string
  position: string
  positionText: string
  points: string
  Driver: Driver
  Constructor: Constructor
  grid: string
  laps: string
  status: string
  Time?: { millis?: string; time?: string }
  FastestLap?: {
    rank?: string
    lap?: string
    Time?: { time?: string }
  }
}

export interface QualifyingResult {
  number: string
  position: string
  Driver: Driver
  Constructor: Constructor
  Q1?: string
  Q2?: string
  Q3?: string
}

export type RaceWithResults = Race & { Results: RaceResult[] }
export type RaceWithSprintResults = Race & { SprintResults: RaceResult[] }
export type RaceWithQualifying = Race & { QualifyingResults: QualifyingResult[] }

export interface DriverRaceResultsResponse {
  MRData: MRData & { RaceTable: { season: string; driverId?: string; Races: RaceWithResults[] } }
}

/** The sprint endpoint keeps the `SprintResults` key, not `Results`. */
export interface DriverSprintResultsResponse {
  MRData: MRData & {
    RaceTable: { season: string; driverId?: string; Races: RaceWithSprintResults[] }
  }
}

export interface DriverQualifyingResponse {
  MRData: MRData & { RaceTable: { season: string; driverId?: string; Races: RaceWithQualifying[] } }
}
```

`CircuitWinnerRace` keeps its inline winner shape; do not refactor it in this
change (different field set, no benefit).

### 4.2 Client (`src/api/client.ts`)

```ts
driverRaceResults: (season, driverId, signal) =>
  get<DriverRaceResultsResponse>(`/${season}/drivers/${driverId}/results/?limit=100`, signal),

driverSprintResults: (season, driverId, signal) =>
  get<DriverSprintResultsResponse>(`/${season}/drivers/${driverId}/sprint/?limit=100`, signal),

driverQualifying: (season, driverId, signal) =>
  get<DriverQualifyingResponse>(`/${season}/drivers/${driverId}/qualifying/?limit=100`, signal),
```

### 4.3 Domain builder (`src/lib/driverSeason.ts`, pure)

One pure function so the numbers can be tested and reviewed outside React:

```ts
export type FinishOutcome = 'finish' | 'retired' | 'dsq' | 'dns'

export interface DriverRoundResult {
  round: number
  name: string
  position: number | null
  positionText: string | null
  status: string | null
  racePoints: number
  sprintPoints: number
  qualifyingPosition: number | null
}

export interface DriverSeason {
  rounds: DriverRoundResult[]            // ascending, union of race + sprint rounds
  points: Array<{ index: number; round: number; value: number }>
  positions: Array<{
    index: number
    round: number
    value: number
    outcome: FinishOutcome
  }>
  stats: DriverStats
}
```

Normalisation rules:

1. A per-driver response contains exactly one row per race; defensively match
   `Results[0]` / `SprintResults[0]` / `QualifyingResults[0]` where
   `Driver.driverId` equals the requested id.
2. Parse every numeric string with `Number(...)` and guard `Number.isFinite`.
   Missing points count as `0`.
3. `outcome` from `positionText`: `/^\d+$/` → `finish`, `R` → `retired`,
   `D` → `dsq`, `W` → `dns`.
4. **X axis** is an event index (`0…n-1`) over the sorted rounds, not the raw
   round number, so a cancelled round does not leave a false gap. The round
   number and race name are kept for labels and tooltips.
5. **Points** are cumulative over the union of race and sprint rounds:
   `running += racePoints + sprintPoints`. A round with only a sprint result
   still advances the line; a round with no data carries the previous total.
6. **Positions** include only race rounds. A retirement/DNS still gets a point
   when Ergast classifies it (numeric `position`); the outcome is used for the
   marker style. A round absent from race results has no point.
7. Sorting is numeric on `Number(round)`, never lexicographic.

### 4.4 Statistics (`DriverStats`)

```ts
export interface DriverStats {
  races: number            // race rows, DNS included
  wins: number             // classified position === 1 (races only)
  retirements: number      // positionText === 'R'
  dns: number              // positionText === 'W'
  dsq: number              // positionText === 'D'
  avgRace: number | null   // mean position over classified finishes
  avgQualifying: number | null
  raceSample: number       // denominators, for the "n =" hint
  qualifyingSample: number
}
```

Recommended definitions (confirm in §12):

| Stat | Rule | Rationale |
| --- | --- | --- |
| Victories | race `position === 1` | Table's `wins` column is race wins; sprint wins are separate |
| Retirements | `positionText === 'R'` | Covers Retired/Accident/Engine/… without a status whitelist |
| Average race position | mean of numeric `position` where `positionText` is numeric | Ergast puts retirements at the back, which would distort the average; DNS/DSQ excluded for the same reason |
| Average qualifying position | mean of qualifying `position` | Every qualifying row has one; no `NC` in the Ergast layer |
| DNS / DSQ | counted and shown only if > 0 | Keeps the sidebar to four headline numbers normally |

Round averages to **one decimal** (`4.7`), not `4.666…`. Show the sample size
as small muted text (`7 races`, `20 sessions`) so the average is auditable.

---

## 5. Fetching, caching and loading

New module `src/api/driverSeason.ts`:

```ts
export async function fetchDriverSeason(
  season: string,
  driverId: string,
  signal: AbortSignal,
): Promise<DriverSeason>
```

- `Promise.all` of the three `api.*` calls, one shared abort signal.
- Normalise through `buildDriverSeason(...)` from `src/lib/driverSeason.ts`.
- **Cache**: module-level `Map<`${season}:${driverId}`, { savedAt, data }>`,
  TTL 10 minutes. Success only; aborted/failed requests are never cached.
  The map resets on reload, which is the right lifetime for chart data.
- No shared in-flight promise: aborting one dialog must not reject another
  caller. A duplicate open before the first resolves is rare and harmless.
- The dialog uses `useFetch(() => fetchDriverSeason(...), [season, driverId])`.
  Closing the dialog unmounts and aborts. Reopening is instant when cached.

Why not prefetch on the Drivers tab: it would fire 3 requests per driver on
every visit (or 12+ for the season aggregate) even when nobody opens the
dialog. First open already costs ~0.3 s because the three calls run in
parallel. Optional later: prefetch on `pointerenter`/`focus` of the icon.

Loading/error behaviour:

- Tabs and the dialog header render immediately.
- Plot area shows `Loading` (`Feedback.tsx`) while `loading && !data`.
- `ErrorState` with `reload` on failure; the sidebar shows `—`.
- Empty (`rounds.length === 0`): "No race data for this driver yet." — rookies
  and pre-season must not crash.

---

## 6. Charts

### 6.1 Approach

Hand-rolled SVG; **no chart library is installed** and none is needed.

Reuse the proven patterns from `ReplayPace.tsx`:

- measure the container with `ResizeObserver` so text stays legible at any
  width (extract a small `useMeasuredWidth` hook; do **not** refactor
  `ReplayPace` in this change);
- `viewBox` sized from the measured width, explicit margins for axes;
- axis ticks with a `niceStep` helper (copy the local helper or lift it to
  `src/lib/chart.ts` if it is used twice).

Do **not** use `smoothPath` here: these series are discrete per event, and a
smoothed curve would imply values between rounds. A straight polyline is
honest and simpler.

### 6.2 Points tab

- y: `0 … niceMax(max(points))`, tick step chosen so there are 4–6 ticks
  (e.g. 0/100/200/300/400 for a 380-point season).
- x: one slot per event; labels are round numbers, thinned when > 20 events.
- One line in the driver's team colour (`teamColor(constructorId)` from
  `src/api/teams.ts`), 2–2.5 px. Light liveries (near-white) would vanish on
  paper: reuse `readableInk(color)` as a guard — when it returns dark ink, fall
  back to `var(--ink)` for the stroke and dots.
- Dots at every event. Sprint weekends are not special-cased in v1.
- `<title>` per dot: `R12 · British Grand Prix · 187 pts`.
- Caption under the plot: `Cumulative points · race + sprint · through round 19`.

### 6.3 Finish position tab

- y: **inverted**, P1 at the top. Domain `1 … maxPositionSeen` (usually 20–22);
  ticks at 1, 5, 10, 15, 20 unless the max is smaller.
- Same x slots and labels as the points tab (race rounds).
- Marker style carries the outcome:
  - `finish` — filled dot;
  - `retired` — hollow dot in `--red`, with a small `R` in the tooltip;
  - `dns` — hollow dot in `--line-strong` (only if Ergast classified it);
  - `dsq` — hollow dot in `--amber`.
- Legend under the plot: `● finish　○ retirement　○ DSQ/DNS` (text, not colour
  alone, for accessibility).
- Caption: `Race classification · P1 at the top · through round N`.

### 6.4 Accessibility and responsiveness

- `role="img"` with a descriptive `aria-label` (driver, metric, range).
- Every point has a `<title>`; the chart also gets a visually hidden summary
  sentence (first/last/best values).
- Tabs are wired with `role="tabpanel"` and `aria-labelledby` matching the ids
  `Tabs.tsx` already emits (`tab-points` → `panel-points`).
- Layout: chart beside a 220–240 px sidebar on desktop; stacks under ~760 px,
  with the stats as a two-column grid. Chart height ~280 px desktop, ~220 px
  on small screens.

---

## 7. UI composition

```
┌ Drivers ────────────────────────────────────────────────────────┐
│ Pos  Driver              Team        Wins  Points  [icon]       │
│  1   ANT Antonelli       Mercedes      9     380    [▁▂▃]        │
│  2   VER Verstappen      Red Bull      7     352    [▁▂▃]        │
└─────────────────────────────────────────────────────────────────┘
                       │ click
                       ▼
┌ Andrea Kimi Antonelli · Mercedes · P1, 380 pts ─────────── [×] ┐
│  [ Points ] [ Finish position ]                                │
│                                                                │
│  400 ┤                                      ╭────              │
│  300 ┤                          ╭───────────╯                  │
│  200 ┤              ╭───────────╯                              │
│  100 ┤      ╭───────╯                           ┌────────────┐ │
│    0 ┼──╯───┴───┴───┴───┴───┴───┴───┴───┴───┴──┘ Victories  │ │
│       1  3  5  7  9 11 13 15 17 19             │ 9          │ │
│                                                │ Retirements│ │
│   Cumulative points · race + sprint            │ 2          │ │
│                                                │ Avg finish  │ │
│                                                │ 3.4        │ │
│                                                │ Avg quali   │ │
│                                                │ 2.1        │ │
│                                                └────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Changes in `DriverStandings.tsx`:

- add `const [statsDriver, setStatsDriver] = useState<DriverStanding | null>(null)`;
- add a sixth `<th className="table__icon">` with `<span className="sr-only">Season statistics</span>`;
- each row gets a `<td className="table__icon">` with a `<button type="button"
  className="table__icon-button" aria-label={`Season statistics for ${driverName(...)}`}>`
  containing a 16 px inline SVG chart glyph (same inline-SVG convention as
  `RowMenu.tsx`);
- render `{statsDriver && <DriverStatsDialog season={season} standing={statsDriver}
  onClose={() => setStatsDriver(null)} />}` after the table.

`DriverStatsDialog.tsx`:

```tsx
<Modal label={`${driverName(standing.Driver)} season statistics`} size="wide" onClose={onClose}>
  <header className="stats__head"> …driver, team, position, points… </header>
  <div className="stats__viewbar">
    <Tabs tabs={STATS_TABS} active={view} onChange={setView}
          ariaLabel="Season chart" variant="compact" />
  </div>
  <div className="stats__body">
    <div className="stats__plot" role="tabpanel" id={`panel-${view}`}
         aria-labelledby={`tab-${view}`}>
      {loading ? <Loading …/> : error ? <ErrorState …/> : <SeasonChart …/>}
    </div>
    <aside className="stats__aside"> …stat list… </aside>
  </div>
</Modal>
```

The dialog receives the whole `DriverStanding` (not just the id) so it can show
the team colour and the table's current position/points without another fetch.

CSS (in `src/index.css`, next to the table and circuit-stat blocks):

- `.table__icon` — narrow right-aligned column (~2.5 rem), hidden header text.
- `.table__icon-button` — 28–32 px square, transparent, `color: var(--ink-muted)`,
  hover/focus `var(--red)`; `:focus-visible` ring reusing existing table-button
  patterns.
- `.stats__head`, `.stats__body` (`grid-template-columns: minmax(0, 1fr) 240px`),
  `.stats__plot`, `.stats__aside`, `.stats__stat`, `.stats__note` — modelled on
  `.circuit__stats` / `.circuit__stat`.
- `.chart-*` — axis/grid/line/dot classes, with `currentColor` for text and
  `vector-effect: non-scaling-stroke` where useful.
- `@media (max-width: 760px)` — stack the body, stats two columns, chart ≤ 220 px.

---

## 8. Files

### New

| File | Purpose |
| --- | --- |
| `src/api/driverSeason.ts` | Fetch 3 endpoints in parallel, 10-minute memory cache, build `DriverSeason` |
| `src/lib/driverSeason.ts` | Pure normalisation, series and stats derivation |
| `src/hooks/useMeasuredWidth.ts` | `ResizeObserver` width for the SVG chart |
| `src/components/DriverStatsDialog.tsx` | Modal shell, tabs, loading/error, stats sidebar |
| `src/components/SeasonChart.tsx` | Generic single-series SVG chart (points/positions) |
| `docs/driver-stats-feature-plan.md` | This document |

### Changed

| File | Change |
| --- | --- |
| `src/api/types.ts` | `RaceResult`, `QualifyingResult`, `RaceWithResults`, `RaceWithQualifying`, two response types |
| `src/api/client.ts` | Three per-driver getters |
| `src/components/DriverStandings.tsx` | Icon column + dialog state |
| `src/index.css` | Icon button, dialog layout, stats, chart |
| `README.md` | Short feature note + endpoint table rows (implementation step) |
| `AGENTS.md` | Add `driverSeason` to the Browser API bullet (optional, one line) |

No change to `worker/`, `api/upstream.ts`, `vite.config.ts`, `vercel.json`,
`package.json`, or `public/`.

---

## 9. Phased plan

1. **Data layer** — types, client getters, `buildDriverSeason`, cache. Verify
   manually against the standings table: cumulative points must equal the
   standings points, and wins/retirements must look sane for 3–4 drivers.
2. **Dialog shell** — icon column, `DriverStatsDialog`, tabs, stats sidebar,
   loading/error/empty. No charts yet; verify the numbers are right.
3. **Points chart** — axes, line, dots, tooltips, caption.
4. **Position chart** — inverted axis, outcome markers, legend.
5. **Polish** — responsive layout, a11y (tab wiring, aria labels, hidden
   summary), theme check in light and dark, cache/abort behaviour.
6. **Tests** (proposal, see §12) — unit-test `src/lib/driverSeason.ts` with
   synthetic rows covering: sprint points, retirement, DNS, DSQ, missing
   race round, qualifying gap. Requires widening `vitest.config.ts` to include
   `src/lib/**/*.test.ts`; the current config runs only `worker/test/**`.
7. **Docs** — README behaviour note and endpoint rows; flip this document to
   `implemented` with an implementation-notes section.

Typical check after implementation:

```sh
npx oxlint
npm run build
npm run worker:typecheck   # src/api/types.ts is in the Worker tsconfig
npm test
```

---

## 10. Edge cases and risks

| Case | Handling |
| --- | --- |
| Race results lag qualifying/standings | Each series uses its own rounds; subtitle says "through round N"; don't merge the standings round |
| Rookie / no results | Empty state; stats show `—`; no fetch loop, 200 with empty `RaceTable` |
| DNS row | Ergast still assigns a numeric position; mark hollow, exclude from averages, footnote (`1 DNS`) |
| Disqualified | `positionText=D`; marker + footnote; not counted as a retirement |
| Retirement classification | Ergast puts `R` at the back; excluded from the average but still plotted and marked |
| Driver changed team mid-season | Row-level `Constructor` is available, but v1 colours the whole line with the standings' current team; not worth per-segment colouring now |
| Cancelled / missing round | x is an event index, not the raw round number |
| Fewer than 2 events | Single dot, no line; no division by zero |
| API failure (one of three) | Whole fetch fails → `ErrorState` + retry; no partial chart |
| Rate limits | 3 parallel requests per first open, cached 10 min; no prefetch |
| 100-row `limit` cap | Per-driver max is 24, so safe; add a `MRData.total > 100` guard only if the calendar ever grows |
| Dark theme | Team colours are fixed hex; the line sits on `--paper`, same as existing chips; check contrast in both themes |
| Sprint-only round (hypothetical) | Points series includes it; position series has no point there |

---

## 11. Decisions taken

1. **Per-driver endpoints, not the season aggregate.** 3 small requests vs 12
   paginated ones, and exactly the requested driver.
2. **Cumulative points include sprint points.** Verified to match the
   standings for every driver; otherwise the chart disagrees with the table.
3. **Retirements are excluded from the average race position.** Ergast
   classifies them at the back, which would punish a fast driver who retired.
   The count is shown separately and the denominator is displayed.
4. **Victories are race wins only**, matching the table's `Wins` column.
5. **Straight polyline, not a smooth curve.** Discrete per-event data.
6. **No chart dependency.** One small purpose-built SVG component.
7. **No Worker involvement.** Charts are not session result tables; the
   "one endpoint per session" rule and the Worker's canonical path stay intact.

---

## 12. Open questions

1. **Average race position** — exclude retirements (recommended) or include
   them as Ergast classifies them? The recommended label is
   `Avg finish` with `(n classified)`.
2. **Extra stats** — should the sidebar also show podiums and poles? Both are
   derivable at zero extra cost (`position <= 3`, qualifying `position === 1`).
   Current plan: keep four headline stats and revisit after reviewing the
   dialog.
3. **Unit test** — add `src/lib/driverSeason.test.ts` and widen the Vitest
   include, or leave it to manual verification? Recommended: add it, because
   the sprint/DNS/DSQ/missing-round cases are hard to reproduce by hand.
4. **Single-driver line only** — an optional faint championship-leader line
   would add context but costs a second driver fetch. Current plan: out of
   scope.

---

## 13. Appendix — measured API facts (2026-11-08)

Queries used (through the same host the app proxies to):

```sh
curl -s -H 'User-Agent: BoxThisLap/1.0' \
  'https://api.jolpi.ca/ergast/f1/2026/drivers/antonelli/results/?limit=100'
curl -s -H 'User-Agent: BoxThisLap/1.0' \
  'https://api.jolpi.ca/ergast/f1/2026/drivers/antonelli/sprint/?limit=100'
curl -s -H 'User-Agent: BoxThisLap/1.0' \
  'https://api.jolpi.ca/ergast/f1/2026/drivers/antonelli/qualifying/?limit=100'
```

Season totals, for the rejected alternative:

| Endpoint | `MRData.total` | Pages at 100 |
| --- | ---: | ---: |
| `/2026/results/` | 418 | 5 |
| `/2026/qualifying/` | 435 | 5 |
| `/2026/sprint/` | 132 | 2 |

`limit=1000` still returns 100 rows and `MRData.limit = "100"`, confirming the
hard cap. Pagination splits a race across pages, so grouping by round and
deduplicating by `driverId` would be mandatory for the season-wide approach.

---

## 14. Implementation notes

The feature shipped in the existing app structure: no new route, no Worker
change, no proxy change, and no chart dependency.

### Answers to the open questions

1. **Average race position** excludes retirements, DNS and DSQ. The hint under
   the figure reads `n classified`, so the denominator is visible.
2. **Four headline stats only.** Podiums and poles remain a cheap future
   addition; the sidebar is kept short for now.
3. **Unit tests were added.** `src/lib/driverSeason.test.ts` covers sprint
   points, a sprint-only round, retirement, DNS, DSQ, missing race rounds, a
   qualifying gap and an unrelated driver row. `vitest.config.ts` now includes
   `src/lib/**/*.test.ts` beside `worker/test/**`.
4. **Single-driver line only.** No championship-leader reference series.

### What shipped

- `src/api/types.ts` — `RaceResult`, `QualifyingResult` and the three
  per-driver response types.
- `src/api/client.ts` — the three one-page getters.
- `src/lib/driverSeason.ts` — pure normalisation, series and statistics;
  averages are rounded to one decimal here, once, so the dialog and the tests
  agree.
- `src/api/driverSeason.ts` — `Promise.all` fetch, success-only 10-minute
  memory cache.
- `src/hooks/useMeasuredWidth.ts` — shared `ResizeObserver` measurement.
  `ReplayPace` was left untouched.
- `src/components/SeasonChart.tsx` — one SVG component for both views.
  Straight polyline, hover cards, inverted position axis, outcome markers and a
  legend. It accepts any `SeasonChartData`, so the constructor dialog reuses it.
- `src/components/SeasonStatsAside.tsx` — the four statistic blocks shared by
  both dialogs.
- `src/components/SeasonStatsNav.tsx` — previous/next arrows and a `1 / 25`
  counter, with `src/lib/seasonIndex.ts` wrapping the list index.
- `src/components/DriverStatsDialog.tsx` — modal, tabs, loading/error/empty,
  stats sidebar and the DNS/DSQ footnote.
- `src/components/DriverStandings.tsx` — icon column and dialog state.
- `src/index.css` — icon button, dialog layout, chart and responsive rules
  (stacked under 780 px, two-column stats grid).

### Deviations

- **Retirements are read from `status`, not only `positionText`.** Jolpica marks an
  unclassified retirement with `positionText: "R"`, but a car that completed
  90% of the distance is classified with a numeric position and `status:
  "Retired"` (Antonelli's 2026 Barcelona row: `16` / `16` / `Retired`). The
  builder checks the explicit `R`/`D`/`W` marker first, then falls back to
  `status`: `Finished`, `Lapped` and `+n Lap(s)` are finishes, DSQ/DNS statuses
  are counted separately, and every other status is a retirement. Retirement
  reasons are free text, so they are not enumerated. Averages key off the
  outcome, which also keeps a classified retirement out of the mean.
- The chart's `niceStep` stays a local helper; it is used once here, so lifting
  `ReplayPace`'s copy into `src/lib/chart.ts` was not worth touching the replay
  in this change.
- **Hover cards replace the native `<title>` tooltips.** Each dot has a wider
  transparent hit target and a card drawn in the SVG, following
  `ReplayPace`'s dot tooltip: round and race name, then the points total and
  the points gained that round, or the exact classification and outcome. The
  card flips and clamps inside the plot so it never leaves the chart.
- **One neutral series colour, not the team livery.** The planned team-coloured
  line made a Ferrari retirement indistinguishable from a Ferrari finish, since
  both were red. The line is now `var(--chart-line)` and the finish markers
  `var(--ink)`, so the two never blend in either theme; only the outcome changes
  the marker colour: black finish, red retirement, amber DSQ/DNS, matching the
  legend exactly. This is consistent across every driver.
- **The Constructors table got the same dialog, points view only.** A team has two
  classifications per round, so a single finish-position line would have to pick
  one car. `api/constructorSeason.ts` reads the same three endpoints filtered by
  constructor and `lib/constructorSeason.ts` sums both cars per round; the stats
  aggregate wins, retirements and car positions. The chart and the stats sidebar
  are shared with the driver dialog.
- **Both dialogs page through the standings list.** The standings component keeps
  the selected index, not the row object, and `lib/seasonIndex.ts` wraps it: at
  the last row Next opens the first, at the first row Previous opens the last.
  The dialog stays mounted while the index changes, so the chosen tab survives
  and only the chart refetches. A live `1 / 25` counter announces the position.
- Series coverage is shown per chart: the points caption uses the last round
  with a race or sprint row, the position caption the last race row, while
  qualifying averages may include a newer round.
- The chart measures its own width and picks 280 px (desktop) or 220 px (under
  520 px) of height, rather than relying on a CSS height.

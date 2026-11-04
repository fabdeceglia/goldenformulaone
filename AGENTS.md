# AGENTS.md

Box this Lap! is a Formula 1 dashboard: a React 19 + Vite SPA in `src/`, plus a
Cloudflare Worker in `worker/src/` that caches session results in KV. Production
is Vercel static hosting plus one Vercel edge function, `api/upstream.ts`.

## Commands

| Command | Notes |
| --- | --- |
| `npm run dev` | Vite on `http://localhost:5173` |
| `npm run worker:dev` | Wrangler on port 8787; run beside `npm run dev` for results |
| `npm run localdev` | Starts both, backgrounding `dev` |
| `npm run build` | `tsc -b && vite build`; typechecks only `src/` and `vite.config.ts`, **not** the Worker |
| `npm run lint` | oxlint (`.oxlintrc.json`); no formatter is configured |
| `npm test` | Vitest; only `worker/test/**/*.test.ts`, no frontend tests |
| `npm run worker:typecheck` | Separate Worker/shared typecheck; run after Worker changes |
| `npm run worker:types` | Regenerate `worker-configuration.d.ts` after a binding change; never hand-edit it |

Single test: `npm test -- worker/test/results.test.ts` or `npm test -- -t "promotes"`.

There is no CI. A typical full check is
`npx oxlint && npm run build && npm run worker:typecheck && npm test`. Use
`npx oxlint` rather than `npm run lint`: the RTK hook rewrites the latter to
`rtk lint`, which shells out to eslint and fails with a JSON parse error.

## Context discipline

Every turn re-sends the whole conversation, so a file read stays expensive for
the rest of the session. Measured: ~90K tokens of context per turn on this repo.

- Locate first, then read a range: `grep` for the symbol, then `read` with
  `offset`/`limit`. Do not read a file over ~300 lines end to end.
- Never read whole: `worker-configuration.d.ts` (~150K tokens, generated), any
  `public/replays/*.json` (31 MB total), `public/circuits.json` (~35K). Query one
  field with `jq`/`grep` instead.
- After an edit, verify with `npm run build` or `worker:typecheck`. Do not
  re-read the file you just wrote.
- Batch independent shell commands into one call; one call, one turn.
- Send multi-file exploration to the `explore` subagent. Its reads never enter
  this conversation, which is what makes it cheap — one subagent costs about 4%
  of an average session here. Keep it inline when the answer is one file or one
  `grep`: a subagent pays its own full context to answer that.
- Do not fan out several subagents on the same question. Parallel copies of one
  job multiply tokens without producing a second answer.
- Stop at the answer. No recap of files already in context.

## Architecture

### Start here

- `src/main.tsx` → `App.tsx` → `SeasonView.tsx` is the whole shell. `App` fetches
  the current-season calendar; `SeasonView` owns the six section tabs, the
  featured event, the circuit-info dialog, and the round/session requested by the
  home hero or schedule.
- `Tabs.tsx` is generic, reused for section and session tabs. No router, no global
  state library; navigation is local React state.
- Styling is global in `src/index.css` (plus scoped animations like
  `components/BattleCarJitter.css`). Theme tokens are CSS custom properties;
  light/dark is `data-theme` on `<html>`, applied before first paint by
  `index.html`.

### Modules

`README.md` is the detailed behavior reference; `docs/*.md` hold feature plans.

- Browser API: `api/client.ts` (Ergast calendar, standings, past winners),
  `api/alpha.ts` (alpha rounds + results index, `SESSION_CODES`),
  `api/resultsService.ts` (the only entry for result tables),
  `api/openf1.ts` (replay/battle only; one serial queue), `api/news.ts` (RSS,
  10-minute cache).
- Hooks: `useFetch` (abort + `reload`/silent `refresh`; `null` to idle),
  `useSeasonRounds` (opaque round-id map, TTL-revalidated by `lib/roundsCache.ts`),
  `useNow` (30-second tick).
- Lib: `lib/schedule.ts` (featured event, weekend windows, default session),
  `lib/format.ts` (UTC→local, bare dates), `lib/grid.ts` (order + gaps),
  `lib/circuitHistory.ts` + `lib/circuits.ts` (history, Ergast id → SVG),
  `lib/replay*.ts` / `lib/battle*.ts` (loaders, IndexedDB, playback math; both
  bypass the Worker).
- `src/components/`: one section/dialog per file. `SessionResultTable` switches
  shape by session code; `StartingGridView` handles `Q`/`SQ`;
  `ReplayDialog`/`BattleDialog` own their loading; `Modal` is the `<dialog>` shell.
- Worker: `index.ts` (routes), `results.ts` (refresh, promotion, rechecks),
  `cache.ts` (KV keys, guarded writes, heartbeat), `schedule.ts` (calendar, round
  ids, driver counts, OpenF1 sessions), `config.ts` (all timeouts/TTLs/caps),
  `http.ts` + `relay.ts` (JSON GET deadline; Vercel relay + direct fallback),
  `sources/jolpica.ts` + `sources/openf1.ts`.
- Shared: `src/shared/results.ts` (wire types, completeness, hashing, state rank),
  `schedule.ts` (UTC windows + codes), `openf1Map.ts` (OpenF1 rows → alpha shape).
  `api/upstream.ts` is the edge relay, jolpi.ca and openf1.org only.

### Data flows

- **Calendar/standings:** section → `api/client.ts` → `/ergast/f1` proxy (or
  `VITE_API_BASE`). `App` gets the season from `/current/races`.
- **Session results:** `RaceResults` → `resultsService` →
  `/api/results/{season}/{round}/{code}` → Worker. Fresh KV result returns now;
  stale returns while `ctx.waitUntil` revalidates; pre-window answers `pending`.
  Cron every two minutes refreshes at most four finished sessions. `final` only
  from a complete jolpica classification; OpenF1 supplies `provisional`.
- **Session tab list:** built locally from `raceSchedule()`. The alpha results
  index only contributes labels for sessions the calendar misses, so a late or
  missing index must never hide a Worker result.
- **Replay:** `ReplayDialog` → `replaySource` → `public/replays/index.json` plus
  baked session JSON; missing session → direct OpenF1 with a 2.1s serial gap,
  cached in IndexedDB `box-this-lap`.
- **1v1 battle:** `BattleDialog` → `battleSource` → direct OpenF1 (500ms gap) and
  Multiviewer geometry, cached in IndexedDB `box-this-lap-battles`.
- **News:** `NewsPanel` → `news.ts` → `/news/<id>` proxies → RSS; merged, deduped,
  ten-minute memory cache; one failing feed does not fail the panel.
- **Circuit info:** `CircuitInfoPanel` → `api.circuitWinners` + `circuitHistory.ts`.

### Rules that keep it coherent

- Add network access behind `src/api/` and load it with `useFetch`; do not fetch
  inside render.
- Keep `src/shared/` isomorphic: no DOM, `import.meta.env`, or ambient clock.
  Pass explicit `now` into time-dependent helpers.
- Results UI consumes `ResultsResponse` for every state. Branch on
  `state`/`source`; never assume `session` is present.
- Do not add another browser path for session result tables. Replay and battle
  are the only intended direct OpenF1 clients.
- `src/lib/schedule.ts` captures `TODAY` at module load. Use `useNow` for UI that
  must tick during a session; a page left open across midnight needs a reload to
  re-pick the featured round.
- `worker/` is bundled by Wrangler, not Vite. Its tsconfig also includes
  `src/shared/**` and `src/api/types.ts`, so shared edits can break the Worker
  typecheck.

## Routing and environment

- `vite.config.ts` proxies `/api` → `127.0.0.1:8787`, `/ergast` and `/f1` →
  `api.jolpi.ca` with the required `User-Agent`, and `/news/<id>` → the five RSS
  feeds.
- `vercel.json` mirrors those rewrites for production. Any change to a proxy or
  news path must be made in **both** files.
- `api/upstream.ts` is a Vercel edge function, not part of the Vite build. The
  Worker reads jolpica and OpenF1 through it because Cloudflare egress IPs get
  rate-limited; it only allows `api.jolpi.ca` and `api.openf1.org`. If the
  production domain changes, update `JOLPICA_RELAY` and `OPENF1_RELAY` in
  `wrangler.jsonc` and redeploy the Worker.
- Build-time overrides: `VITE_API_BASE`, `VITE_ALPHA_BASE`, `VITE_RESULTS_BASE`,
  `VITE_NEWS_BASE`, `VITE_OPENF1_BASE`, `VITE_MULTIVIEWER_BASE`.
- Dev-only clock override: append `?now=2026-10-25T22:05:00Z`. It is compiled
  out of production (`src/lib/clock.ts`).

## Data quirks

- API times are UTC and displayed in the visitor's timezone, but bare calendar
  dates (no time) must **not** be converted; use the helpers in
  `src/lib/format.ts`. Shifting one moves races to the wrong day.
- jolpica alpha responses are sometimes bare and sometimes wrapped in
  `{ metadata, data }`; normalize with `unwrapAlpha` in `src/shared/alpha.ts`.
- Alpha results are keyed by opaque round ids (`round_JqmngOvt`), not round
  numbers. Use `/f1/alpha/core/rounds/?year={season}` to map them.
- `src/api/teams.ts` holds standings colours; session results use the colour
  returned by the alpha API. Chip ink is chosen from livery luminance.
- Worker tests use an in-memory `FakeKV`, stub global `fetch`, and pass explicit
  times (`now`, `scheduledTime`). The 20s test timeout exists because the OpenF1
  adapter deliberately serialises calls with a 500ms gap.

## Generated and committed assets

- `public/replays/*.json`, `public/replays/index.json`, and
  `public/circuits.json` are baked, committed artifacts. Regenerate rather than
  hand-edit:
  - `npm run replays -- --season 2026`
  - `npm run replays -- --season 2026 --latest 3`
  - `npm run replays -- --session 11388 --force`
  Raw OpenF1 responses cache under `.cache/` (git-ignored).
- `public/circuits/*.svg` are vendored track layouts; `src/lib/circuits.ts` maps
  Ergast circuit ids to those filenames manually.
- `worker-configuration.d.ts` is generated by Wrangler.

## TypeScript and operations

- `verbatimModuleSyntax` is on: use `import type` for types.
- `erasableSyntaxOnly` is on: no enums, namespaces, or parameter properties.
- Style is no semicolons, single quotes, 100 columns, trailing commas
  (`.prettierrc`). Write to it directly; `npm run format` is for bulk reflow,
  not a per-task step.
- Unused locals and parameters are errors in the app, node, and Worker configs;
  the Worker config is also `strict`.
- `npm run readiness` / `readiness:report` and `npm run results:watch` are live
  upstream probes, not tests. `readiness` writes gitignored `.readiness/` data
  and can watch a whole session with `--loop`; `results:watch` reads the
  deployed Worker state and prints only on change.
- Deployment has two independent targets: Vercel (app and `api/upstream.ts`) and
  Cloudflare (`npm run worker:deploy`, Worker `boxthislap-results`, KV binding
  `RESULTS`). When changing the relay, deploy Vercel before the Worker.

`README.md` is the detailed behavior/data-flow reference for each feature;
`docs/*.md` are feature plans and implementation records, including the Worker
runbook in `docs/results-cache-worker-plan.md` §12.4. Read the relevant section
before changing a feature rather than inferring behavior from component names.

## Workflow of development
 - test components just at the end of the feature, ask for it
 - test just very important feature, edge cases not easy to take by the human
 - never commit and push, the human will do it in a separate session

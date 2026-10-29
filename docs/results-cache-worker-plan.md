# Results Cache Worker — Implementation Plan

> Status: **planning**. No implementation yet. Revised 2026-10-28 after checking the
> platform and upstream limits against current Cloudflare, Vercel, jolpica and OpenF1
> documentation.
> Setup: Cloudflare free account created 2026-10-23; Wrangler authentication pending.
> Owner: Fabrizio · Created: 2026-10-23 · Revised: 2026-10-28
> Target branch: `feat/results-cache-worker`
> Folder note: `docs/` sits outside the Vite build (the build only bundles
> `index.html` + `src/` and copies `public/`), so this document is version-controlled
> but **never shipped** in `dist/`.

---

## 1. Goal

Make results available reliably even when:

- jolpica publishes late or not at all;
- OpenF1 is in its live-session blackout;
- nobody has the site open at the moment a result first appears.

The fix is a small shared cache in front of both sources:

```
Vercel static app
  └── /api/results/*
        └── Cloudflare Worker
              ├── KV: last good result per session
              └── Cron: warm the cache around session windows
```

The frontend keeps rendering the existing `AlphaSessionResults` shape. It no longer
talks to OpenF1 directly for results, and it no longer needs its own lock detection or
per-device cache.

---

## 2. Why this is needed

### 2.1 The failure observed on 2026-10-23

| Time (UTC) | Event |
| --- | --- |
| 18:30 | FP1 ends |
| 19:00 | OpenF1 has 22 FP1 entries |
| ~20:30 | OpenF1 free access locks for the next live session |
| 21:00 | FP2 starts; jolpica still returns **0** FP1 results |
| 22:30 | OpenF1 free access is expected to return |

The browser fallback can only fetch OpenF1 while a tab is open, so a cache is written
only if a visit happens during the gap. That is not something we can rely on. A
scheduled server-side fetch would have captured FP1 at 19:00 and served it to every
visitor afterwards.

### 2.2 Why the current setup is not enough

- The frontend fallback is **per-browser**. A cache written on one device does not help
  another.
- The fallback only runs when a result page is opened. If nobody visits, no data is
  captured.
- Every visitor makes their own upstream requests, which adds rate-limit pressure and
  gives inconsistent results.
- The browser cannot read OpenF1's 401 body through CORS, so lock detection is currently
  a schedule heuristic.
- jolpica asks for a custom `User-Agent`; browsers cannot set it. Production currently
  calls jolpica directly without one.
- The alpha API is explicitly unfinished and its envelope has changed before. A backend
  can isolate that instability from the frontend.

### 2.3 Why not Vercel-only

Vercel Hobby cron runs **at most once per day**, with hour-level precision. That is not
enough to warm results around a session.

A Vercel-only alternative would need:

- a Vercel Function,
- an external cron service,
- a hosted Redis/KV,
- and secrets to connect them.

That is more moving parts than one Cloudflare Worker. The static frontend stays on
Vercel.

---

## 3. Decision

Use **Cloudflare Workers + KV + Cron** for the results cache. Keep Vercel for the static
frontend.

| Decision | Choice |
| --- | --- |
| Compute | One Cloudflare Worker |
| Storage | One Workers KV namespace |
| Scheduling | One cron trigger, every 2 minutes |
| Frontend origin | Vercel, same-origin `/api/results/*` via a Vercel rewrite |
| Canonical source | jolpica alpha |
| Provisional fallback | OpenF1 `session_result`, all sessions in v1 |
| Wire shape | Existing `AlphaSessionResults` plus cache metadata |
| Cost | Cloudflare Free + Vercel Hobby = $0 |

### 3.1 What "KV" means here

A key–value store is a server-side dictionary:

```text
result:2026:18:FP1  ->  { state, source, session, sources, ... }
result:2026:18:FP2  ->  { ... }
```

One JSON blob per session. No tables, queries or schema migrations. Cloudflare KV is
shared by every Worker invocation and every visitor, unlike `localStorage`, which is
per-browser.

### 3.2 Free-tier budget

Cloudflare Free (checked 2026-10-28):

| Limit | Free tier | Our expected use |
| --- | --- | --- |
| Worker requests | 100,000/day | Cron 720/day + client reads |
| Worker CPU | 10 ms/invocation, including cron | Keep each tick to a few sessions and measure |
| Cron triggers | 5/account, minute-level | 1 trigger |
| Cron wall time | 15 min/invocation | Far more than needed |
| Subrequests | 50/invocation | ~6 per session; cap the tick at 3–5 sessions |
| Simultaneous connections | 6/invocation | Serialize per-source calls |
| KV storage | 1 GB | ~1–2 MB/season |
| KV reads | 100,000/day | Metadata + one or two per client request |
| KV writes | 1,000/day to different keys | Transitions only, plus the heartbeat |
| KV same-key writes | 1/sec | One writer per key; guard against races |

**Write discipline.** A 2-minute cron is 720 ticks/day. Persisting `checkedAt` or source
status for every session on every tick would be 5,040 writes/day for seven sessions, five
times the free limit. The persisted `CachedResult` therefore changes only when:

- the result state or the displayed classification changes;
- a source transitions between `ready`, `empty`, `locked` and `error`;
- a final result is rechecked and the classification actually differs.

Volatile "last checked" information belongs in logs or in a single `meta:status` blob,
not in every `result:` key. The heartbeat is one key every 10 minutes (144 writes/day);
do not also write a per-session status key every tick.

**Upstream budgets.** jolpica allows **4 requests/second burst and 500 requests/hour**
sustained for unauthenticated clients. Seven pending sessions polled every 2 minutes is
210 requests/hour, which fits but is not free: metadata refreshes and on-demand calls must
fit in the same budget. OpenF1's free tier is 3 requests/second and 30/minute, so the
Worker must reuse the serial request queue rather than fire every session at once.

Cron Triggers execute in **UTC** and are not guaranteed to run at the exact scheduled
second. All session-window math must therefore be UTC, and the design must tolerate a tick
arriving a little late.

KV is eventually consistent: a write can take **60 seconds or more** to be visible in
other locations, and negative lookups ("the key does not exist") are cached too. That is
acceptable for results that already take minutes to publish, but client polling should
not be faster than that window. KV's `cacheTtl` defaults to 60 seconds and cannot be set
below 30; lowering it does not make writes visible faster.

---

## 4. Scope

### In scope (v1)

- One Worker endpoint for one session's result.
- jolpica canonical fetch and normalization.
- OpenF1 results fallback for every session, with server-side 401/403/429 handling.
- KV cache with `pending` / `provisional` / `final` states.
- Cron warmer around session windows.
- Vercel rewrite so the frontend calls `/api/results/...` same-origin.
- Frontend switch to the Worker response.
- `/status` endpoint for debugging and readiness.
- README and docs updates.

### Out of scope (for v1)

- Proxying the calendar, standings, news or replays through the Worker.
- A paid OpenF1 API key. The warmer should capture practice results before the next
  live lock; a key can be added later if needed.
- A database, queue, Durable Object or WebSocket/SSE.
- User accounts, authentication or per-user state.
- Historical backfill of every past session. The Worker can fetch on demand; a backfill
  script can come later.
- Real-time live timing.

---

## 5. Architecture

### 5.1 Request path

```
Browser
  GET /api/results/2026/18/FP1
        │
        ▼
Vercel rewrite
        │
        ▼
Cloudflare Worker
  ├── read KV result:2026:18:FP1
  ├── if cached: return it
  └── if missing/stale: refresh once, write, return
        │
        ├── jolpica alpha
        └── OpenF1 (results fallback, all sessions)
```

### 5.2 Cron path

```
Cloudflare Cron (every 2 min)
  ├── load calendar + round-id map from KV (refresh daily)
  ├── find sessions that are finished and not final
  ├── refresh jolpica
  ├── if jolpica complete: write final, stop polling that session
  ├── else refresh OpenF1 (all sessions)
  ├── if OpenF1 ready: write provisional
  └── keep checking jolpica to promote when it publishes
```

The cron is the important part. The on-demand refresh is a convenience for the first
visitor and for local testing; the cron is what makes the cache reliable when nobody is
looking.

### 5.3 Source priority

1. jolpica complete → `final`
2. OpenF1 complete → `provisional`
3. jolpica non-empty but incomplete → `provisional` with `source: "jolpica"`
4. OpenF1 non-empty but incomplete → `provisional` with `source: "openf1"`
5. nothing → `pending`

jolpica remains canonical during the transition. A provisional OpenF1 table is replaced as
soon as jolpica has a complete classification. This is the **v1 transition priority**;
the target OpenF1-primary priority is in §18.

### 5.4 Completeness

A payload is complete when:

- it contains at least `expected - 1` drivers, where `expected` comes from the season's
  driver standings and falls back to 20. Standings can include reserve or replacement
  drivers, and a DNS or withdrawal reduces the starters, so an exact count is too strict;
- **at least one raw source row has a real position** — not a position synthesized while
  mapping; and
- for races and sprints, the winner and at least one classified finisher are present.

Retirements may legitimately lack a position. The check is applied to the raw source
payload (or the pre-mapping rows) so a partial OpenF1 response cannot be promoted to
`final` just because the mapper filled in positions. This otherwise matches the readiness
probe's existing definition.

---

## 6. Data model

### 6.1 KV keys

| Key | Value | Refresh |
| --- | --- | --- |
| `meta:calendar:{season}` | calendar races used for session windows | daily / 12h |
| `meta:rounds:{season}` | round number → alpha round id | daily / 12h |
| `meta:openf1:sessions:{season}` | OpenF1 session list for name/date matching | 6h |
| `meta:drivers:{season}` | expected driver count | daily |
| `meta:status` | last cron run, last error, per-session summary | every 10 min |
| `result:{season}:{round}:{code}` | one `CachedResult` | on change |

Final results have no TTL, but they are rechecked for post-race amendments (see §7.6). Old
sessions can stay in KV; 1 GB is far more than this app needs. A later cleanup job can
prune seasons if necessary.

### 6.2 `CachedResult`

```ts
type ResultState = 'pending' | 'provisional' | 'final'
type SourceState = 'ready' | 'empty' | 'locked' | 'error'

/** Persisted with CachedResult; updated only when the summary changes. */
interface SourceStatus {
  state: SourceState
  count: number
  complete: boolean
  checkedAt: string
  error?: string
  retryAt?: string
}

/** Returned by a refresh, not written to KV on every tick. */
interface SourceCheck extends SourceStatus {
  source: 'jolpica' | 'openf1'
}

interface CachedResult {
  v: 2
  /** Monotonic per key. A writer refuses to replace a higher revision. */
  revision: number
  season: string
  round: string
  code: SessionCode
  state: ResultState
  source: 'jolpica' | 'openf1' | null
  complete: boolean
  session: AlphaSessionResults | null
  fetchedAt: string | null
  checkedAt: string
  nextAttemptAt: string | null
  /** Final results only: when the next amendment check is due (§7.6). */
  recheckAt: string | null
  sources: {
    jolpica: SourceStatus
    openf1: SourceStatus
  }
}
```

Notes:

- `session` is the existing wire shape, so `SessionResultTable` needs no changes.
- `fetchedAt` is when the displayed session data was fetched.
- `checkedAt` is the last **persisted** upstream check. Transient per-tick checks are
  logged and summarized in `meta:status`; they are not written to every result key.
- `nextAttemptAt` implements backoff without hammering a failing source. Write it when
  entering a backoff state, not on every attempt that is already backing off.
- `recheckAt` is set when a result becomes `final`; the cron uses it to re-fetch for
  post-race amendments.
- `revision` increases on every accepted write. A writer re-reads the key and refuses to
  overwrite a higher revision, or to replace `final` with a lower-priority state.
- `sources.openf1.state = "locked"` is exact: the Worker can read the 401/403 response.
- `sources` is exposed to the frontend so the UI can explain *why* a result is pending.
- If `v` is not the current version, treat the key as missing and refetch rather than
  guessing at an old shape.

### 6.3 HTTP response

```ts
interface ResultsResponse {
  state: ResultState
  source: 'jolpica' | 'openf1' | null
  complete: boolean
  session: AlphaSessionResults | null
  fetchedAt: string | null
  checkedAt: string
  pollAfterMs: number | null
  sources: CachedResult['sources']
}
```

- `pollAfterMs`: 60s while pending or provisional, `null` when final. This is not faster
  than KV's 60-second propagation window; a 30-second poll can return the same stale value.
- Return HTTP 200 for `pending`; it is a valid state, not an error.
- Return 400 for invalid parameters and 404 for an unknown route. Validate `season`,
  `round` and `code` before using them in KV keys.
- Send `Cache-Control: no-store` for `pending` and `provisional`. For `final`, a short
  `public, max-age=30` (or an ETag) is safe and reduces Worker/KV reads; keep it short
  because final results can still be amended. ETag/CDN caching can be expanded later.

---

## 7. Worker behavior

### 7.1 Routes

| Route | Purpose |
| --- | --- |
| `GET /api/results/{season}/{round}/{session}` | one session's result/status |
| `GET /api/status` | last cron run and per-session source status |
| `GET /health` | trivial liveness check |

Optional, for manual testing only:

| Route | Purpose |
| --- | --- |
| `POST /api/refresh/{season}/{round}/{session}` | force a refresh, protected by `REFRESH_TOKEN` |

If the manual route is added, keep the token in a Worker secret. If not, use
`wrangler dev --test-scheduled` for local cron testing.

### 7.2 Refresh algorithm

```text
refreshSession(session):
  cached = read KV
  now = Date.now()

  if cached.state == 'final' and cached.recheckAt != null and now < cached.recheckAt:
      return cached

  checks = []
  jolpica = fetchJolpica(session)
  checks.push(jolpica)

  if jolpica.complete:
      candidate = final(jolpica)
  else if openf1Allowed(cached, now):
      # v1: OpenF1 is tried for every session, including Q, SR and R.
      openf1 = fetchOpenF1(session)
      checks.push(openf1)
      candidate = chooseBest(jolpica, openf1)
  else:
      candidate = bestOf(jolpica)

  candidate.sources = summarize(cached?.sources, checks)
  writeIfNewer(session, candidate)   # never downgrade final; compare revision
  return candidate
```

Rules:

- Always try jolpica first.
- If jolpica is complete, never overwrite it with OpenF1.
- If jolpica is incomplete, try OpenF1 for **all** sessions in v1 (`FP1`–`FP3`, `SQ`,
  `SR`, `Q`, `R`), not just practice. This is what §8.2 and the Phase 7 goal require.
- If jolpica is incomplete but non-empty, it can be shown provisionally.
- If OpenF1 is more complete than jolpica, show OpenF1 provisionally.
- Keep polling jolpica after a provisional result; promote as soon as it is complete.
- If OpenF1 returns 401 or 403, mark `locked` and skip OpenF1 until `retryAt`; keep
  polling jolpica. `openf1Allowed` is false while `sources.openf1.retryAt` is in the
  future, and the skip still costs no OpenF1 request.
- If OpenF1 returns 429 or a network error, mark `error` and back off; respect
  `Retry-After` when present.
- If jolpica errors, still try OpenF1.
- Use a 5-second timeout on upstream requests, and a single overall deadline for an
  on-demand refresh (see §7.4). Two sequential 5-second requests must not turn into a
  10-second wait.
- All writes go through `writeIfNewer`: set `candidate.revision = cached.revision + 1`,
  re-read the key, skip if `current.revision >= candidate.revision`, and never replace
  `final` with `pending` or `provisional`. The guard is best-effort because KV reads can
  be stale across regions; if strict serialization is ever needed, use a Durable Object.
- Route OpenF1 requests through one serial queue with a 500 ms gap. Do not issue a
  session's result, driver and grid calls concurrently.
- Do **not** write `checkedAt` on every tick. Only persist when the state, count or
  displayed classification changes, when a source state transitions, or when a final
  result is amended.

### 7.3 Cron selection

The cron runs every 2 minutes. It does **not** fetch every session every time.

A session is due when:

- `now >= estimated end` (results do not exist before the flag);
- the session is not `final`, or it is `final` and `now >= recheckAt`;
- for a non-final session, `now <= estimated end + 24h`; final results use `recheckAt`
  instead;
- and the cached `nextAttemptAt` is in the past.

Additional rules:

- Poll jolpica every tick while pending, subject to the per-tick cap and the 500
  requests/hour budget.
- After a provisional result, poll jolpica less often (e.g. every 5 minutes) and keep the
  provisional table available.
- After 24 hours, stop frequent polling. Keep the provisional result and let an on-demand
  request refresh it when `checkedAt` is stale (see §7.4).
- Cap each tick at **3–5 sessions**. Concurrency limits simultaneous connections, not
  total subrequests: seven sessions at roughly six subrequests each is close to the free
  limit of 50. Prefer a smaller tick over a failed invocation.
- Run refreshes with `Promise.allSettled` so one bad session does not fail the whole tick.
- Serialize OpenF1 calls through the 500 ms queue and stay below 3 requests/second and
  30/minute.
- The 10 ms CPU limit applies to cron invocations too. Keep each tick small and watch
  `cpuTime` in `wrangler tail`; a paid plan is the fallback if parsing several sessions
  consistently exceeds it.
- Cron runs in UTC. Do not reuse the browser's `TODAY` or `NOW_MILLIS`.

The exact backoff and batch size can be tuned after the first race weekend.

### 7.4 On-demand refresh

`GET /api/results/...`:

1. Read KV.
2. If present and fresh, return it.
3. If present but stale (`final` with `recheckAt` due, or a non-final result whose
   persisted `checkedAt` is more than 24 hours old), return the cached value immediately
   and refresh in `ctx.waitUntil()`.
4. If missing and the session is old enough to have results, refresh once with an overall
   8-second deadline (5 seconds per upstream call), write the result, and return.
5. If the refresh fails, return `pending` with source statuses.

This makes the first visitor useful even if the cron has not run yet, and a stale
provisional table never blocks a later jolpica result. A per-isolate in-memory promise can
coalesce duplicate refreshes; it does not prevent cross-region duplicate work, which is
acceptable at this traffic level. Writes still go through the revision guard, so a
duplicate refresh cannot downgrade a `final` result.

### 7.5 Session windows

The Worker needs the same session windows as the frontend:

- `FP1`, `FP2`, `FP3`: 60 minutes
- `SQ`: 30 minutes
- `SR`: 45 minutes
- `Q`: 60 minutes
- `R`: 120 minutes

These are estimates, deliberately generous. Extract the pure schedule logic into a
shared module rather than importing `src/lib/schedule.ts` directly: that file imports
`clock.ts`, which touches `window` and `import.meta.env`.

Suggested shared module:

```text
src/shared/schedule.ts
  - SESSION_MINUTES
  - sessionWindows(race): SessionWindow[]
  - sessionStart/sessionEnd helpers
```

`src/lib/schedule.ts` can keep the browser-specific `TODAY`, `NOW_MILLIS` and live/featured
logic and re-export/use the pure helpers. The Worker must do all window math in **UTC**;
the visitor's timezone is a presentation concern only.

### 7.6 Final reconciliation

`final` is not immutable. Race classifications can change after publication (DSQ,
penalties, fastest-lap corrections), so a cached final result must be rechecked:

- set `recheckAt` when a result becomes final: first at +1 hour, then +6 hours, +24 hours
  and +72 hours; if an existing final has no `recheckAt`, treat it as due once;
- on each recheck, fetch jolpica, compare a hash of the classification (positions, status,
  points and components) and write only when it changed;
- after the last recheck, leave the final result in KV and stop polling;
- if a recheck fails or returns an incomplete payload, keep the final result and push
  `recheckAt` forward (e.g. +1 hour) instead of retrying on every tick;
- an on-demand request for a final result past `recheckAt` refreshes it in the background
  with `ctx.waitUntil()`.

That keeps the write cost tiny while ensuring a post-race penalty reaches every visitor.
A recheck that finds no change updates only `recheckAt`, so it is one write per step.

---

## 8. Source adapters

### 8.1 jolpica

- Base: `https://api.jolpi.ca`
- Calendar: `/ergast/f1/{season}/races/?limit=100`
- Round ids: `/f1/alpha/core/rounds/?year={season}`
- Results: `/f1/alpha/results/{roundId}/{code}/`
- Drivers: `/ergast/f1/{season}/driverstandings/?limit=100`
- Headers: `Accept: application/json`, `User-Agent: GoldenFormulaOne/1.0.0 (+https://github.com/fabdeceglia/goldenformulaone)`
- Rate limits: 4 requests/second burst and 500 requests/hour sustained for unauthenticated
  access. Back off on `429` and respect `Retry-After`; keep the cron well inside the budget.
- Normalize the alpha envelope (`{ metadata, data }` or bare payload) in one place.
- Treat an empty `results` array as `empty`, not an error.

### 8.2 OpenF1

- Base: `https://api.openf1.org/v1`
- Sessions: `/sessions?year={season}` — cache for 6 hours.
- Results: `/session_result?session_key={key}`
- Drivers: `/drivers?session_key={key}`
- Match jolpica session → OpenF1 session by year + session name + scheduled start, with
  circuit key as a tiebreaker. This is the same join the current frontend uses.
- `401` or `403` means the free-tier live blackout. Store `locked` and the exact
  status/message.
- `404` or a `200` with `[]` means no results yet; treat as `empty`.
- `429` means rate limited; back off and respect `Retry-After` in either seconds or
  HTTP-date form.
- OpenF1's real-time feed requires a paid subscription. The Worker only needs the
  historical classification after the flag, which is free.
- Route all OpenF1 requests through one serial queue (500 ms gap). Do not issue a
  session's result, driver and grid calls concurrently.
- Map OpenF1 rows into `AlphaSessionResults` with the existing mapping logic, but compute
  completeness from the raw rows' real `position` values before mapping. Do not invent a
  position for an unclassified row.
- v1 uses OpenF1 for every session: `FP1`–`FP3`, `SQ`, `SR`, `Q` and `R`. The race and
  sprint grid is filled from the corresponding qualifying session's `starting_grid`
  feed (`Q` for `R`, `SQ` for `SR`), which is the actual grid including penalties; if
  that feed is unavailable, the qualifying classification order is used. This is the
  transition design; the OpenF1-primary target in §18 reverses the source priority.

### 8.3 Attribution and licensing

- Keep the existing OpenF1 attribution in the UI.
- OpenF1 data is CC BY-NC-SA 4.0; this remains a personal, non-commercial project.
- Do not expose any future OpenF1 API key to the browser.

---

## 9. Frontend changes

### 9.1 New client module

Add `src/api/resultsService.ts`:

```ts
export interface ResultsResponse { ... }

export async function sessionResults(
  season: string,
  round: string,
  code: SessionCode,
  signal: AbortSignal,
): Promise<ResultsResponse>
```

Default base: `/api/results` (same origin). In development, Vite proxies `/api` to
`http://127.0.0.1:8787` (Wrangler).

### 9.2 `RaceResults.tsx`

Replace the current `alpha.session` + `provisionalResults` split with one request.

Render states:

- `final`: existing table, no note.
- `provisional`: existing table plus
  *"Provisional classification from OpenF1 — jolpica has not published this session yet."*
  or the equivalent jolpica-partial wording.
- `pending`: existing pending message.
- `pending` with `sources.openf1.state === "locked"`: the accurate lock message.
- `error` / Worker unavailable: error state with retry.

The frontend no longer needs:

- `src/lib/provisionalCache.ts`;
- `provisionalResults()` / `isOpenF1FallbackSession()` for the results view;
- the `openF1Locked` schedule heuristic;
- direct OpenF1 result requests;
- the provisional `ProvisionalResults` union.

The session index (`alpha.resultsIndex`) can stay direct for v1, **but the tab list must
not depend on it alone**. If jolpica has not indexed a session, a Worker provisional result
would be unreachable. Build the tabs from `raceSchedule(selectedRace)`, filtered to
sessions that have started, and use `alpha.resultsIndex` only for labels or additional
sessions. Moving the index behind the Worker is a later optimization.

### 9.3 Polling

Point the current polling loop at `/api/results` initially; the Worker cache absorbs
duplicate requests. Use `pollAfterMs` from the response as soon as the Worker returns it:

- pending: 60s
- provisional: 60s
- final: stop

Sixty seconds matches KV's propagation window; polling faster mostly returns the same
cached value.

### 9.4 Rollout

Do the Worker first, verify it with `curl`, then switch the frontend in a separate commit.
That makes rollback easy: revert the frontend commit and the app returns to the old path
while the Worker stays deployed.

---

## 10. File layout

```
worker/
  src/
    index.ts          # fetch + scheduled handlers, routing
    config.ts         # bindings, constants, timeouts
    cache.ts          # KV keys, read/write helpers
    schedule.ts       # calendar/round map, session windows
    results.ts        # refresh + promotion state machine
    sources/
      jolpica.ts
      openf1.ts
  test/
    fixtures/         # small captured payloads for manual checks
  tsconfig.json
wrangler.jsonc
src/shared/
  results.ts          # CachedResult / ResultsResponse / SourceStatus / SourceCheck types
  schedule.ts         # pure session-window helpers
  openf1Map.ts        # pure OpenF1 -> AlphaSessionResults mapping
  alpha.ts            # pure alpha envelope unwrap helper
src/api/resultsService.ts
```

The Worker is bundled by Wrangler; Vite ignores it. Shared modules must not import
browser-only code.

---

## 11. Configuration and deployment

### 11.1 Prerequisites

The Cloudflare free account has been created. Before the Worker can be scaffolded, the
following must be in place:

| Item | Status / action |
| --- | --- |
| Cloudflare account | Created (free plan) |
| Wrangler authentication | Owner runs `npx wrangler@latest login`, completes browser consent, then `npx wrangler@latest whoami` succeeds |
| Worker name | `boxthislap-results` |
| `workers.dev` subdomain | Existing or chosen once for the account; the Worker URL becomes `https://boxthislap-results.<subdomain>.workers.dev` |
| KV namespace | Created in §11.2; the namespace id goes into `wrangler.jsonc` |
| Vercel project | Existing static deployment; rewrite added in §11.4 |
| OpenF1 API key | Not needed in v1 |
| Credit card / custom domain | Not needed |

The browser consent step must be completed by the account owner; the agent cannot approve
it. Once `wrangler whoami` works, the rest can be run from this repo.

#### If using an API token instead of browser login

Create a scoped Cloudflare API token with:

- **Workers KV Storage: Edit**
- **Workers Scripts: Edit**
- **Account Settings: Read**

Then expose it to the shell as `CLOUDFLARE_API_TOKEN` and run Wrangler commands from
there. Do **not** paste the token into this document or a chat. The account id and KV
namespace id are identifiers, not secrets; the API token is a secret.

#### What the agent needs after authentication

- Confirmation that `wrangler whoami` succeeds.
- The chosen Worker name and `workers.dev` subdomain (or permission to use
  `boxthislap-results` and read the subdomain from Wrangler).
- The KV namespace id, which the agent can create and capture directly.

No password, 2FA code, credit card, custom domain or OpenF1 key is required.

### 11.2 Cloudflare setup

Once Wrangler is authenticated:

```sh
npm i -D wrangler
npx wrangler whoami
npx wrangler kv namespace create RESULTS
```

The last command prints a namespace id. Copy it into `wrangler.jsonc` (the recommended
config format; `wrangler.toml` is still supported):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "boxthislap-results",
  "main": "worker/src/index.ts",
  "compatibility_date": "2026-10-01",
  "kv_namespaces": [
    { "binding": "RESULTS", "id": "<namespace-id>" }
  ],
  "triggers": {
    "crons": ["*/2 * * * *"]
  },
  "vars": {
    "JOLPICA_USER_AGENT": "GoldenFormulaOne/1.0.0 (+https://github.com/fabdeceglia/goldenformulaone)"
  }
}
```

Run `npx wrangler types` after adding bindings, and include the generated
`worker-configuration.d.ts` in `worker/tsconfig.json`.

Dashboard alternative: **Workers & Pages → KV → Create namespace**, name it `RESULTS`,
then copy the namespace id from its details page.

Optional later, if a paid OpenF1 key is added:

```sh
npx wrangler secret put OPENF1_API_KEY
```

Do not put secrets in `wrangler.jsonc`, the frontend, or this document.

### 11.3 Package scripts

```json
{
  "scripts": {
    "worker:dev": "wrangler dev",
    "worker:deploy": "wrangler deploy",
    "worker:tail": "wrangler tail",
    "worker:types": "wrangler types",
    "worker:typecheck": "tsc -p worker/tsconfig.json --noEmit"
  }
}
```

Add `.wrangler/` and `.dev.vars` to `.gitignore`.

### 11.4 Vercel rewrite

Add these entries to the existing `rewrites` array in `vercel.json` (keep the news
rewrites):

```json
[
  {
    "source": "/api/results/:path*",
    "destination": "https://<worker-subdomain>.workers.dev/api/results/:path*"
  },
  {
    "source": "/api/status",
    "destination": "https://<worker-subdomain>.workers.dev/api/status"
  },
  {
    "source": "/health",
    "destination": "https://<worker-subdomain>.workers.dev/health"
  }
]
```

This keeps the browser same-origin, so no CORS work is needed. The Worker URL is public
and contains no secret. Vercel's external-rewrite proxy has a 120-second timeout, well
above the Worker's on-demand budget.

If `/api/status` and `/health` are only used for debugging, the rewrites can be skipped
and the Worker URL called directly; the production `curl` checks in §12.3 already do that.
If external path rewrites cause trouble, fall back to calling the Worker directly with
`VITE_RESULTS_BASE` and restrict CORS to `https://boxthislap.vercel.app` and
`http://localhost:5173`.

### 11.5 Local development

- `npm run worker:dev` starts Wrangler on `http://127.0.0.1:8787`.
- `npm run dev` proxies `/api` to Wrangler.
- Use `wrangler dev --test-scheduled` and the local route
  `/cdn-cgi/local/scheduled?cron=*/2+*+*+*+*` to run the cron handler. Add
  `?time=<epoch-ms>` to override `controller.scheduledTime` for deterministic tests.
- The Worker should accept an injected `now` in its refresh functions so tests can freeze
  time without browser globals. The scheduled test route covers the cron entry point.

### 11.6 Deploy order

1. Deploy the Worker and KV namespace (`wrangler types`, then `wrangler deploy`).
2. Seed the calendar/round metadata by calling `/api/results/...` or the cron.
3. Verify `/api/status` and `/health`.
4. Add the Vercel rewrites for results, status and health, then deploy the frontend.
5. Verify the app in production.
6. Keep the previous frontend commit as the rollback point.

---

## 12. Testing

### 12.1 Unit-level

Test the pure functions without Cloudflare:

- alpha envelope unwrap;
- OpenF1 → `AlphaSessionResults` mapping;
- completeness calculation from **raw** OpenF1 rows (not mapped positions);
- session window calculation in UTC;
- source-priority selection (jolpica complete vs partial vs OpenF1);
- state-rank/revision guard (a provisional result cannot replace `final`);
- final-recheck hash comparison.

The repo has no test runner today. Start with a small Node script or `node:test` over the
shared modules; add Vitest if the test surface grows or if Node cannot strip the shared
TypeScript syntax.

### 12.2 Worker integration

Use `wrangler dev` and fixture-backed source adapters:

1. jolpica ready → `final`, source `jolpica`.
2. jolpica empty + OpenF1 ready → `provisional`, source `openf1` — for a practice session
   **and** for `Q`, `SR` and `R`.
3. jolpica empty + OpenF1 401 or 403 → `pending`, `openf1.state = locked`.
4. cached provisional + jolpica later ready → promoted to `final`.
5. cached final before `recheckAt` → cron skips it.
6. cached final after `recheckAt` with a changed classification → updated in place.
7. OpenF1 429 → backoff, no repeated hammering.
8. malformed alpha envelope → normalized or reported as an error, not a crash.
9. missing KV key → on-demand refresh path.
10. stale provisional → returned immediately, refreshed in `ctx.waitUntil()`.
11. cron and a request writing the same key → `final` is not downgraded.
12. a tick with the maximum session count stays under the subrequest and write budgets.
13. OpenF1 `200 []` → `empty`, indistinguishable from `404` for completeness purposes.

### 12.3 Production validation

Before the next session:

- `curl https://<worker>/health`
- `curl https://<worker>/api/status`
- `curl https://<worker>/api/results/2026/18/FP1`
- check the Vercel rewrite path in the browser
- confirm the frontend shows `pending`, `provisional`, and `final` correctly

During the weekend:

- compare the Worker's first-seen times with `npm run readiness:report`
- confirm a cached provisional table survives the next live lock
- confirm jolpica promotion happens without a page reload (polling)
- watch `wrangler tail` for upstream errors, `cpuTime`, jolpica 429s and timeouts
- check the KV write count in the Cloudflare dashboard; a 2-minute cron should not
  approach 1,000 writes/day
- confirm the session tabs appear even when `alpha.resultsIndex` is empty or late

Success criteria:

- first non-empty result captured within 5 minutes of either source publishing;
- every client sees the same source/state;
- a provisional table remains available during the next live lock;
- jolpica replaces it when it publishes;
- a post-race amendment is picked up by the final recheck;
- no direct OpenF1 result calls from the frontend;
- free-tier usage stays comfortably within limits, including KV writes and jolpica's
  500 requests/hour.

---

## 13. Observability

- `/api/status` returns the last cron heartbeat and a per-session summary from one
  `meta:status` blob. It must not list every `result:` key on each request.
- `console.log` structured events: session, source, count, state transition, duration,
  `cpuTime`, KV writes, 429s, error.
- `wrangler tail` for live logs.
- Later, an external uptime monitor can hit `/health` or `/api/status` and alert if the
  cron heartbeat is older than, say, 15 minutes.
- The existing `.readiness` scripts remain useful for measuring publication delays and
  comparing sources; they are not part of production serving.

---

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| KV eventual consistency | Results are not instant; 60s+ propagation is acceptable; poll at 60s and accept cached negatives |
| KV write limit | Persist only transitions; one `meta:status` blob; no per-tick `checkedAt` writes |
| KV same-key write race | Revision guard; never downgrade `final`; one writer per key where possible |
| Worker 10ms CPU | Cap the tick at 3–5 sessions; watch `cpuTime`; paid plan only if needed |
| Cron failure is silent on free tier | `/status` heartbeat + optional uptime monitor; on-demand refresh still works |
| jolpica alpha changes shape | Isolate unwrap/normalization in one module; add fixtures |
| jolpica 429 / 500-per-hour limit | Budget polling; back off and respect `Retry-After`; keep cron batches small |
| jolpica publishes late | Keep polling; serve OpenF1 provisional in the meantime |
| Final result is amended after publication | `recheckAt` at 1h/6h/24h/72h; compare hash and update |
| OpenF1 live lock | Capture results before the lock; cache them; exact 401/403 handling server-side |
| OpenF1 rate limits | Serial 500 ms queue; stay below 3/s and 30/min; respect `Retry-After` |
| Vercel external rewrite issue | Fallback to direct Worker URL + CORS; 120s proxy timeout |
| Two-platform deploy | Document deploy order and keep rollback to the previous frontend commit |
| Duplicate refresh from cron + request | In-isolate coalescing plus the revision guard; cross-region duplicates are acceptable |
| Partial result shown as final | Completeness from raw positions; race winner/finisher check; keep polling until complete |
| Session tabs hidden by a late alpha index | Build tabs from the calendar/session windows, not `alpha.resultsIndex` alone |
| Stale provisional never promotes | On-demand staleness check and background refresh after 24h |

---

## 15. Open questions

1. Worker name and `workers.dev` subdomain.
2. KV namespace id (needs the Cloudflare account).
3. Cron cadence and batch size: start with 2 minutes and 3–5 sessions; tune after the
   first weekend against the jolpica hourly budget.
4. How long to keep polling jolpica after a provisional result: 24h initially.
5. Whether to add a protected manual refresh endpoint.
6. Whether to move the results index behind the Worker in v1 or later; the tab list must
   fall back to the calendar either way.
7. Whether to add a paid OpenF1 key later.
8. Whether to add ETag/CDN caching after measuring traffic.
9. Whether to keep the local readiness scripts as-is or fold their reporting into
   `/api/status`.
10. Final recheck schedule: 1h/6h/24h/72h is the starting point; add a weekly check only
    if real amendments are missed.

---

## 16. Implementation checklist

### Phase 0 — Account and skeleton

- [x] Create Cloudflare free account (done 2026-10-23)
- [x] Install Wrangler
- [x] Authenticate Wrangler (`npx wrangler@latest login`; verify `wrangler whoami`)
- [x] Confirm the `workers.dev` subdomain (`boxthislap-results.fabrizio-dec90.workers.dev`)
- [x] Create KV namespace `RESULTS` and capture its id
- [x] Add `wrangler.jsonc` and run `wrangler types`
- [x] Add `/health` and `/api/status`
- [x] Deploy a skeleton Worker and verify the URL

### Phase 1 — jolpica + KV

- [x] Add shared types and alpha unwrap
- [x] Add calendar/round-id metadata cache
- [x] Add jolpica adapter
- [x] Add KV `CachedResult` read/write with `revision` and `state` guard
- [x] Split durable `CachedResult` from transient `SourceCheck`
- [x] Add `GET /api/results/...`
- [x] Add completeness calculation from raw source rows
- [x] Add final recheck (`recheckAt`) scaffolding
- [x] Test with a finished session (e.g. FP1) via curl

### Phase 2 — OpenF1 fallback

- [x] Add OpenF1 session list cache and session-key join
- [x] Move/reuse the OpenF1 → alpha mapping
- [x] Add all-session OpenF1 fallback, including race/sprint grid enrichment
- [x] Add 401/403/404/`[]`/429 handling and backoff
- [x] Add the serial OpenF1 request queue
- [x] Test locked/empty/ready cases

### Phase 3 — cron

- [x] Add scheduled handler
- [x] Add session-window selection in UTC
- [x] Add promotion/backoff state machine
- [x] Add final-recheck schedule
- [x] Add `Promise.allSettled` and per-session logging
- [x] Add the tick cap (3–5 sessions) and subrequest/CPU budget check
- [x] Add one `meta:status` heartbeat, not per-session status writes
- [x] Test locally with `--test-scheduled` and `?time=`
- [x] Deploy and verify cron runs

### Phase 4 — frontend

- [x] Add `resultsService.ts`
- [x] Switch `RaceResults.tsx`
- [x] Add final/provisional/pending/locked UI states
- [x] Build tabs from `raceSchedule()` with `alpha.resultsIndex` as a supplement
- [x] Remove `provisionalCache.ts`, the FE OpenF1 result fallback and the lock heuristic
- [x] Update polling to use `pollAfterMs` at 60s (or keep current cadence initially)

### Phase 5 — production verification

- [x] Add Vercel rewrites for results, status and health
- [x] Deploy frontend
- [x] Verify `/api/results/...` through Vercel
- [x] Verify `/api/status`
- [ ] Run through a practice session
- [ ] Confirm promotion when jolpica publishes
- [ ] Check KV writes/day and jolpica 429s
- [x] Update README and this document's status

### Phase 6 — optional hardening

- [ ] ETag / CDN caching
- [ ] External uptime monitor
- [ ] Manual refresh endpoint
- [ ] Proxy results index/calendar
- [ ] Paid OpenF1 key if the free gap is still a problem
- [ ] Evaluate a SQLite-backed Durable Object if KV write/consistency races appear

### Phase 7 — OpenF1-primary migration

- [ ] Add `PRIMARY_SOURCE` flag, default `jolpica`
- [ ] Add `primary` / `enrichment` fields to `CachedResult` and bump `v`
- [ ] Split refresh into primary and enrichment passes
- [ ] Merge jolpica points, fastest lap and official grid into OpenF1 results
- [ ] Compare both sources for one race weekend
- [ ] Flip to `PRIMARY_SOURCE=openf1`
- [ ] Remove the browser fallback and `provisionalCache.ts`
- [ ] Verify a full weekend with the Worker only

---

## 17. Suggested commit plan

On `feat/results-cache-worker`:

1. `worker: add cached results service skeleton`
2. `worker: fetch jolpica and cache session results`
3. `worker: add all-session OpenF1 fallback and cron`
4. `web: read results from the cache worker`
5. `docs: document the results cache worker`

If the Worker and frontend switch feel safer as separate reviews, split into two branches:

- `feat/results-cache-worker` — Worker only, tested by curl.
- `feat/results-cache-frontend` — switch the app after the Worker is verified.

---

## 18. Migration to OpenF1-primary

### 18.1 Why invert the priority

OpenF1 is the faster source for every session. It publishes a usable classification shortly
after the flag, while jolpica can lag for hours. The current fallback already proves the
mapping works for `FP1`–`FP3`, `SQ`, `SR`, `Q` and `R`, including race/sprint grid
enrichment from qualifying.

The target is:

- **OpenF1 is primary** for first publication and for the table the user sees while jolpica
  is late.
- **jolpica is enrichment, fallback and the canonical check**: official points, fastest
  lap, penalty-adjusted grid, status text and a second opinion when the two sources
  disagree.
- **The Worker/KV cache is shared** by every visitor and warmed by cron, so a result is
  captured even when nobody has the site open.

This is a data-source inversion, not a rewrite. The `AlphaSessionResults` wire shape, the
table components and the Worker routes stay the same.

### 18.2 Target source priority

| Priority | OpenF1 | jolpica | Result |
| --- | --- | --- | --- |
| 1 | complete | complete | `final`, OpenF1 timing + jolpica enrichment |
| 2 | complete | empty/incomplete | `provisional` from OpenF1; keep polling jolpica |
| 3 | empty/incomplete/locked | complete | `final` from jolpica (fallback) |
| 4 | non-empty but incomplete | non-empty but incomplete | `provisional` from the more complete source |
| 5 | nothing | nothing | `pending` |

Rules:

- Never replace a good OpenF1 result with an empty jolpica response.
- A complete OpenF1 result is published immediately; it does not wait for jolpica.
- Once jolpica is complete, merge its official fields into the cached OpenF1 result and
  promote to `final`.
- If the two sources disagree, keep the OpenF1 timing/position for the provisional view,
  log the discrepancy, and use jolpica's official field for the final view. A mismatch is
  a signal to inspect, not a reason to blank the table.
- OpenF1 `401`/`403` during a live session means "locked", not "empty". Serve the cached
  provisional result and retry after the lock window.

### 18.3 Merge rules

Match entries by OpenF1 `driver_number` and jolpica `permanent_car_number`/abbreviation.
For each driver:

| Field | Preferred source | Fallback |
| --- | --- | --- |
| Position | OpenF1 while provisional; jolpica when final | the other source |
| Total/lap time | OpenF1 | jolpica |
| Laps | OpenF1 | jolpica |
| Status (finished/retired/DNS/DSQ) | OpenF1 flags, jolpica text when final | the other source |
| Points | jolpica | OpenF1 `points` |
| Fastest lap | jolpica `components.FLAP` | derive from OpenF1 `/laps` later |
| Grid | jolpica `components.GRID` (official, includes penalties) | OpenF1 `starting_grid` (also includes penalties), then qualifying order |
| Q1/Q2/Q3 components | OpenF1 `duration` array | jolpica components |
| Team/driver names | jolpica (canonical spelling) | OpenF1 `drivers` |

Starting-grid clarification:

- OpenF1's `/starting_grid` is keyed to qualifying/sprint qualifying, not the race. For
  `Q`/`SQ` it returns the actual race grid, including grid penalties; a race-session key
  returns `404`.
- jolpica has **no separate starting-grid endpoint** either. The official grid is exposed
  as `components.GRID` inside the race result (or `Results[].grid` in the Ergast shape),
  not as its own resource.
- Therefore the Worker prefers jolpica `components.GRID` once the race result is available,
  and uses OpenF1 `starting_grid` for `Q`/`SQ` while waiting. If that feed is unavailable,
  it falls back to the qualifying classification order, which is a reasonable provisional
  grid but does not include penalties and may omit drivers without a qualifying time.

### 18.4 Worker changes

1. Add a `PRIMARY_SOURCE` setting with `openf1` and `jolpica` values. Ship with
   `jolpica` during the transition; flip to `openf1` after a race weekend of comparison.
2. Extend `CachedResult` and bump `v`:
   ```ts
   type ResultSource = 'openf1' | 'jolpica' | 'openf1+jolpica'
   interface CachedResult {
     // existing fields...
     v: 3
     primary: ResultSource
     enrichment: {
       jolpica: SourceStatus
       mergedAt: string | null
     }
   }
   ```
3. Split the refresh into two operations:
   - `refreshPrimary(session)` — OpenF1 first when the flag is `openf1`, otherwise jolpica.
   - `refreshEnrichment(session, primary)` — the other source, merged only when complete.
4. Reuse the §5.4 completeness rule: expected drivers with tolerance, a real position from
   the source rows, and for races the winner plus at least one classified finisher.
5. Write a provisional result as soon as OpenF1 is complete; do not wait for the
   enrichment pass.
6. Promote to `final` when the primary is complete and either:
   - jolpica enrichment is complete, or
   - the enrichment grace period has passed (e.g. 6 hours) and the primary has been stable.
   Set `recheckAt` on promotion and use the §7.6 amendment checks.
7. Keep polling jolpica after a provisional result. Never overwrite a good provisional
   with a worse one; the revision/state guard applies to the merged result too.
8. Cache the OpenF1 session list and driver list for the season; only fetch per-session
   results and qualifying grids on refresh.

### 18.5 Frontend changes

- Point `RaceResults.tsx` at `/api/results/...` only; remove the direct OpenF1 fallback,
  the schedule lock heuristic and `provisionalCache.ts`.
- Keep the same table and starting-grid components.
- Do not show a source label. The API response can carry `source`/`state` metadata, and the
  app can log it to the console for power users.
- Keep the existing pending/locked copy; it explains why a table is not there yet, not
  where the data came from.

### 18.6 Rollout and rollback

| Step | Action | Exit criterion |
| --- | --- | --- |
| 1 | Deploy Worker with `PRIMARY_SOURCE=jolpica` | Existing behaviour unchanged |
| 2 | Add OpenF1-primary code behind the flag; compare both sources in logs | No unexplained mismatches |
| 3 | Flip to `PRIMARY_SOURCE=openf1` for one race weekend | Every session publishes from OpenF1 |
| 4 | Remove the browser fallback and local cache | One source of truth in the Worker |
| 5 | Update README and this document | Docs match production |

Rollback is a flag change back to `jolpica`; KV keeps the last good result, so users do not
lose the table during the switch.

### 18.7 Risks

- **OpenF1 live lock**: the free tier returns `401`/`403` during live sessions. Mitigate
  with the cron warmer, the KV cache and jolpica fallback.
- **OpenF1 is not the official classification**: use jolpica for points, fastest lap,
  penalties and the final canonical check.
- **Grid penalties**: OpenF1's qualifying order is not the official grid. Prefer jolpica
  `components.GRID` once available; label the provisional grid as qualifying order only in
  the data, not in the UI.
- **Schema drift**: keep the OpenF1 adapter small and covered by fixture tests; log unknown
  fields rather than dropping rows.
- **Rate limits**: keep the serial request queue, respect `Retry-After`, and avoid
  per-visitor upstream calls.
- **Licensing**: OpenF1 is CC BY-NC-SA 4.0; keep attribution and keep the project
  non-commercial.

### 18.8 Acceptance criteria

- Every session (`FP1`–`FP3`, `SQ`, `SR`, `Q`, `R`) gets a table from OpenF1 within the
  normal publication window, without a browser tab being open.
- Race and sprint tables include a grid column filled from jolpica when available, or from
  the corresponding OpenF1 qualifying `starting_grid` otherwise.
- jolpica remains a working fallback and enrichment source; a jolpica outage does not blank
  the table.
- No user-facing source note. Source and state are available in the API response and the
  browser console.
- The Worker survives the OpenF1 live lock using cached provisional results.
- A post-race amendment is reflected by the final-recheck schedule.
- Session tabs appear even when `alpha.resultsIndex` has not listed the session yet.

---

## 19. References

- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Cron Triggers: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Cloudflare KV overview: <https://developers.cloudflare.com/kv/>
- Cloudflare KV limits: <https://developers.cloudflare.com/kv/platform/limits/>
- Cloudflare KV consistency: <https://developers.cloudflare.com/kv/concepts/how-kv-works/>
- Cloudflare KV reads and `cacheTtl`: <https://developers.cloudflare.com/kv/api/read-key-value-pairs/>
- Wrangler configuration: <https://developers.cloudflare.com/workers/wrangler/configuration/>
- Wrangler cron testing: <https://developers.cloudflare.com/workers/examples/cron-trigger/>
- Vercel Hobby cron limits: <https://vercel.com/docs/cron-jobs/usage-and-pricing>
- Vercel rewrite limits: <https://vercel.com/docs/limits>
- jolpica-f1: <https://github.com/jolpica/jolpica-f1>
- jolpica rate limits: <https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md>
- OpenF1: <https://openf1.org/>
- OpenF1 API docs: <https://openf1.org/docs>

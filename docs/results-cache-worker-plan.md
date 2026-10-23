# Results Cache Worker — Implementation Plan

> Status: **planning**. No implementation yet.
> Setup: Cloudflare free account created 2026-10-23; Wrangler authentication pending.
> Owner: Fabrizio · Created: 2026-10-23
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
| Provisional fallback | OpenF1 `session_result`, practice only in v1 |
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

Cloudflare Free, as of 2026:

| Limit | Free tier | Our expected use |
| --- | --- | --- |
| Worker requests | ~100k/day | Cron 720/day + client reads |
| Worker CPU | 10 ms/invocation | Fetch wait is not CPU; mapping ~22 rows is tiny |
| Cron triggers | 5/account, minimum every minute | 1 trigger |
| Subrequests | ~50/invocation | 3–6 per refresh |
| KV storage | 1 GB | ~1–2 MB/season |
| KV reads | ~100k/day | One or two per client request |
| KV writes | ~1k/day | Only when a result or source state changes |

The design must **not write a status key every tick**. Write only when the result changes
or a source state transitions. A separate heartbeat can be written every 10 minutes if
needed.

KV is eventually consistent: a write can take up to about 60 seconds to be visible
everywhere. That is acceptable for results that already take minutes to publish.

---

## 4. Scope

### In scope (v1)

- One Worker endpoint for one session's result.
- jolpica canonical fetch and normalization.
- OpenF1 practice fallback with server-side 401/429 handling.
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
        └── OpenF1 (practice fallback)
```

### 5.2 Cron path

```
Cloudflare Cron (every 2 min)
  ├── load calendar + round-id map from KV (refresh daily)
  ├── find sessions that are finished and not final
  ├── refresh jolpica
  ├── if jolpica complete: write final, stop polling that session
  ├── else refresh OpenF1 (practice only)
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

jolpica remains canonical. A provisional OpenF1 table is replaced as soon as jolpica has
a complete classification.

### 5.4 Completeness

A payload is complete when:

- it contains at least the expected number of drivers (from the season's driver
  standings, falling back to 20), and
- at least one entry has a position.

Retirements may legitimately lack a position. This matches the readiness probe's existing
definition and avoids promoting a partial classification to `final`.

---

## 6. Data model

### 6.1 KV keys

| Key | Value | Refresh |
| --- | --- | --- |
| `meta:calendar:{season}` | calendar races used for session windows | daily / 12h |
| `meta:rounds:{season}` | round number → alpha round id | daily / 12h |
| `meta:openf1:sessions:{season}` | OpenF1 session list for name/date matching | 6h |
| `meta:drivers:{season}` | expected driver count | daily |
| `meta:heartbeat` | last cron run, last error | every 10 min |
| `result:{season}:{round}:{code}` | one `CachedResult` | on change |

Final results have no TTL. Old sessions can stay in KV; 1 GB is far more than this app
needs. A later cleanup job can prune seasons if necessary.

### 6.2 `CachedResult`

```ts
type ResultState = 'pending' | 'provisional' | 'final'
type SourceState = 'ready' | 'empty' | 'locked' | 'error'

interface SourceStatus {
  state: SourceState
  count: number
  complete: boolean
  checkedAt: string
  error?: string
  retryAt?: string
}

interface CachedResult {
  v: 1
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
  sources: {
    jolpica: SourceStatus
    openf1: SourceStatus
  }
}
```

Notes:

- `session` is the existing wire shape, so `SessionResultTable` needs no changes.
- `fetchedAt` is when the displayed session data was fetched.
- `checkedAt` is the last upstream attempt, even if nothing changed.
- `nextAttemptAt` implements backoff without hammering a failing source.
- `sources.openf1.state = "locked"` is exact: the Worker can read the 401 response.
- `sources` is exposed to the frontend so the UI can explain *why* a result is pending.

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

- `pollAfterMs`: 30s while pending, 60s while provisional, `null` when final.
- Return HTTP 200 for `pending`; it is a valid state, not an error.
- Return 400 for invalid parameters and 404 for an unknown route.
- Phase 1 can send `Cache-Control: no-store`. The Worker cache is the important cache.
  ETag/CDN caching can be added later if request volume needs it.

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

  if cached.state == 'final': return cached

  jolpica = fetchJolpica(session)
  if jolpica.complete:
      write final(jolpica)
      return

  if !isPractice(session.code):
      write pending-or-provisional(jolpica)
      return

  openf1 = fetchOpenF1(session)
  if openf1.complete:
      write provisional(openf1)
  else if openf1.locked:
      write pending-or-provisional(jolpica, openf1.locked)
      set openf1.retryAt = now + 15 min
  else:
      write best-available(jolpica, openf1)
```

Rules:

- Always try jolpica first.
- If jolpica is complete, never overwrite it with OpenF1.
- If jolpica is incomplete but non-empty, it can be shown provisionally.
- If OpenF1 is more complete than jolpica, show OpenF1 provisionally.
- Keep polling jolpica after a provisional result; promote as soon as it is complete.
- If OpenF1 returns 401, mark `locked` and skip OpenF1 until `retryAt`; keep polling
  jolpica.
- If OpenF1 returns 429 or a network error, mark `error` and back off; respect
  `Retry-After` when present.
- If jolpica errors, still try OpenF1 for practice.
- Use a 5-second timeout on upstream requests so a stuck source cannot hold the Worker.

### 7.3 Cron selection

The cron runs every 2 minutes. It does **not** fetch every session every time.

A session is due when:

- `now >= estimated end` (results do not exist before the flag);
- `now <= estimated end + 24h`, unless the result is already final;
- the cached `nextAttemptAt` is in the past;
- and the session is not already final.

Additional rules:

- Poll jolpica every tick while pending.
- After a provisional result, poll jolpica less often (e.g. every 5 minutes) and keep the
  provisional table available.
- After 24 hours, stop frequent polling. Keep the provisional result and retry jolpica
  occasionally (e.g. once a day) or leave it until the next page request.
- Limit concurrent refreshes to a small number (3–5) to stay well inside subrequest and
  CPU limits.

The exact backoff can be tuned after the first race weekend.

### 7.4 On-demand refresh

`GET /api/results/...`:

1. Read KV.
2. If present, return it.
3. If missing and the session is old enough to have results, refresh once with a 5-second
   budget, write the result, and return.
4. If the refresh fails, return `pending` with source statuses.

This makes the first visitor useful even if the cron has not run yet. A per-isolate
in-memory promise can coalesce duplicate refreshes; a distributed lock is unnecessary for
this traffic level.

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
logic and re-export/use the pure helpers.

---

## 8. Source adapters

### 8.1 jolpica

- Base: `https://api.jolpi.ca`
- Calendar: `/ergast/f1/{season}/races/?limit=100`
- Round ids: `/f1/alpha/core/rounds/?year={season}`
- Results: `/f1/alpha/results/{roundId}/{code}/`
- Drivers: `/ergast/f1/{season}/driverstandings/?limit=100`
- Headers: `Accept: application/json`, `User-Agent: GoldenFormulaOne/1.0.0 (+GitHub URL)`
- Normalize the alpha envelope (`{ metadata, data }` or bare payload) in one place.
- Treat an empty `results` array as `empty`, not an error.

### 8.2 OpenF1

- Base: `https://api.openf1.org/v1`
- Sessions: `/sessions?year={season}` — cache for 6 hours.
- Results: `/session_result?session_key={key}`
- Drivers: `/drivers?session_key={key}`
- Match jolpica session → OpenF1 session by year + session name + scheduled start, with
  circuit key as a tiebreaker. This is the same join the current frontend uses.
- `401` means the free-tier live blackout. Store `locked` and the exact message/status.
- `404` means no results yet; treat as `empty`.
- `429` means rate limited; back off and respect `Retry-After`.
- Map OpenF1 rows into `AlphaSessionResults` with the existing mapping logic.
- v1 only uses OpenF1 for `FP1`/`FP2`/`FP3`. Qualifying can be added later if its data
  proves useful.

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

Replace the current `alpha.session` + `practiceResults` split with one request.

Render states:

- `final`: existing table, no note.
- `provisional`: existing table plus
  *"Provisional classification from OpenF1 — jolpica has not published this session yet."*
  or the equivalent jolpica-partial wording.
- `pending`: existing pending message.
- `pending` with `sources.openf1.state === "locked"`: the accurate lock message.
- `error` / Worker unavailable: error state with retry.

The frontend no longer needs:

- `src/lib/practiceCache.ts`;
- `practiceResults()` / `isPracticeSession()` for the results view;
- the `openF1Locked` schedule heuristic;
- direct OpenF1 result requests;
- the practice-only `PracticeResults` union.

The session index (`alpha.resultsIndex`) can stay direct for v1. Moving it behind the
Worker is a later optimization.

### 9.3 Polling

Keep the current polling behavior initially, but point it at `/api/results`. The Worker
cache absorbs duplicate requests. Later, use `pollAfterMs` from the response to reduce
client polling:

- pending: 30s
- provisional: 60s
- final: stop

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
wrangler.toml
src/shared/
  results.ts          # CachedResult / ResultsResponse / SourceStatus types
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
| KV namespace | Created in §11.2; the namespace id goes into `wrangler.toml` |
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

The last command prints a namespace id. Copy it into `wrangler.toml`:

```toml
name = "boxthislap-results"
main = "worker/src/index.ts"
compatibility_date = "2026-10-01"

[[kv_namespaces]]
binding = "RESULTS"
id = "<namespace-id>"

[triggers]
crons = ["*/2 * * * *"]

[vars]
JOLPICA_USER_AGENT = "GoldenFormulaOne/1.0.0 (+https://github.com/fabdeceglia/goldenformulaone)"
```

Dashboard alternative: **Workers & Pages → KV → Create namespace**, name it `RESULTS`,
then copy the namespace id from its details page.

Optional later, if a paid OpenF1 key is added:

```sh
npx wrangler secret put OPENF1_API_KEY
```

Do not put secrets in `wrangler.toml`, the frontend, or this document.

### 11.3 Package scripts

```json
{
  "scripts": {
    "worker:dev": "wrangler dev",
    "worker:deploy": "wrangler deploy",
    "worker:tail": "wrangler tail",
    "worker:typecheck": "tsc -p worker/tsconfig.json --noEmit"
  }
}
```

Add `.wrangler/` and `.dev.vars` to `.gitignore`.

### 11.4 Vercel rewrite

Add to `vercel.json`:

```json
{
  "source": "/api/results/:path*",
  "destination": "https://<worker-subdomain>.workers.dev/api/results/:path*"
}
```

This keeps the browser same-origin, so no CORS work is needed. The Worker URL is public
and contains no secret.

If external path rewrites cause trouble, fall back to calling the Worker directly with
`VITE_RESULTS_BASE` and restrict CORS to `https://boxthislap.vercel.app` and
`http://localhost:5173`.

### 11.5 Local development

- `npm run worker:dev` starts Wrangler on `http://127.0.0.1:8787`.
- `npm run dev` proxies `/api` to Wrangler.
- Use `wrangler dev --test-scheduled` and the `__scheduled` endpoint to run the cron
  handler locally.
- Add a `?now=` test path later if needed; the Worker should accept an injected `now`
  in its refresh functions so tests can freeze time without browser globals.

### 11.6 Deploy order

1. Deploy the Worker and KV namespace.
2. Seed the calendar/round metadata by calling `/api/results/...` or the cron.
3. Verify `/api/status`.
4. Add the Vercel rewrite and deploy the frontend.
5. Verify the app in production.
6. Keep the previous frontend commit as the rollback point.

---

## 12. Testing

### 12.1 Unit-level

Test the pure functions without Cloudflare:

- alpha envelope unwrap;
- OpenF1 → `AlphaSessionResults` mapping;
- completeness calculation;
- session window calculation;
- source-priority selection (jolpica complete vs partial vs OpenF1).

The repo has no test runner today. Start with a small Node script or `node:test` over the
shared modules; add Vitest only if the test surface grows.

### 12.2 Worker integration

Use `wrangler dev` and fixture-backed source adapters:

1. jolpica ready → `final`, source `jolpica`.
2. jolpica empty + OpenF1 ready → `provisional`, source `openf1`.
3. jolpica empty + OpenF1 401 → `pending`, `openf1.state = locked`.
4. cached provisional + jolpica later ready → promoted to `final`.
5. cached final → cron skips it.
6. OpenF1 429 → backoff, no repeated hammering.
7. malformed alpha envelope → normalized or reported as an error, not a crash.
8. missing KV key → on-demand refresh path.

### 12.3 Production validation

Before the next session:

- `curl https://<worker>/api/status`
- `curl https://<worker>/api/results/2026/18/FP1`
- check the Vercel rewrite path in the browser
- confirm the frontend shows `pending`, `provisional`, and `final` correctly

During the weekend:

- compare the Worker's first-seen times with `npm run readiness:report`
- confirm a cached provisional table survives the next live lock
- confirm jolpica promotion happens without a page reload (polling)
- watch `wrangler tail` for upstream errors and CPU/timeout warnings

Success criteria:

- first non-empty result captured within 5 minutes of either source publishing;
- every client sees the same source/state;
- a provisional table remains available during the next live lock;
- jolpica replaces it when it publishes;
- no direct OpenF1 result calls from the frontend;
- free-tier usage stays comfortably within limits.

---

## 13. Observability

- `/api/status` returns the last cron heartbeat and per-session source status.
- `console.log` structured events: session, source, count, state transition, duration,
  error.
- `wrangler tail` for live logs.
- Later, an external uptime monitor can hit `/health` or `/api/status` and alert if the
  cron heartbeat is older than, say, 15 minutes.
- The existing `.readiness` scripts remain useful for measuring publication delays and
  comparing sources; they are not part of production serving.

---

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| KV eventual consistency | Results are not instant; 60s propagation is acceptable |
| KV write limit | Write only on result/state change; heartbeat every 10 min |
| Worker 10ms CPU | Keep normalization small; fetch wait is not CPU; use paid plan only if needed |
| Cron failure is silent on free tier | `/status` heartbeat + optional uptime monitor; on-demand refresh still works |
| jolpica alpha changes shape | Isolate unwrap/normalization in one module; add fixtures |
| jolpica publishes late | Keep polling; serve OpenF1 provisional in the meantime |
| OpenF1 live lock | Capture results before the lock; cache them; exact 401 handling server-side |
| OpenF1 rate limits | Centralized backoff; respect `Retry-After` |
| Vercel external rewrite issue | Fallback to direct Worker URL + CORS |
| Two-platform deploy | Document deploy order and keep rollback to the previous frontend commit |
| Duplicate refresh from cron + request | Low traffic; optional in-isolate promise coalescing |
| Partial result shown as final | Completeness threshold; keep polling until complete |

---

## 15. Open questions

1. Worker name and `workers.dev` subdomain.
2. KV namespace id (needs the Cloudflare account).
3. Cron cadence: start with 2 minutes; tune after the first weekend.
4. How long to keep polling jolpica after a provisional result: 24h initially.
5. Whether to add a protected manual refresh endpoint.
6. Whether to move the results index behind the Worker in v1 or later.
7. Whether to add a paid OpenF1 key later.
8. Whether to add ETag/CDN caching after measuring traffic.
9. Whether to keep the local readiness scripts as-is or fold their reporting into
   `/api/status`.

---

## 16. Implementation checklist

### Phase 0 — Account and skeleton

- [x] Create Cloudflare free account (done 2026-10-23)
- [ ] Install Wrangler
- [ ] Authenticate Wrangler (`npx wrangler@latest login`; verify `wrangler whoami`)
- [ ] Confirm Worker name `boxthislap-results` and the `workers.dev` subdomain
- [ ] Create KV namespace `RESULTS` and capture its id
- [ ] Add `wrangler.toml`
- [ ] Add `/health` and `/api/status`
- [ ] Deploy a skeleton Worker and verify the URL

### Phase 1 — jolpica + KV

- [ ] Add shared types and alpha unwrap
- [ ] Add calendar/round-id metadata cache
- [ ] Add jolpica adapter
- [ ] Add KV `CachedResult` read/write
- [ ] Add `GET /api/results/...`
- [ ] Add completeness calculation
- [ ] Test with a finished session (e.g. FP1) via curl

### Phase 2 — OpenF1 fallback

- [ ] Add OpenF1 session list cache and session-key join
- [ ] Move/reuse the OpenF1 → alpha mapping
- [ ] Add practice fallback
- [ ] Add 401/404/429 handling and backoff
- [ ] Test locked/empty/ready cases

### Phase 3 — cron

- [ ] Add scheduled handler
- [ ] Add session-window selection
- [ ] Add promotion/backoff state machine
- [ ] Add heartbeat
- [ ] Test locally with `--test-scheduled`
- [ ] Deploy and verify cron runs

### Phase 4 — frontend

- [ ] Add `resultsService.ts`
- [ ] Switch `RaceResults.tsx`
- [ ] Add final/provisional/pending/locked UI states
- [ ] Remove `practiceCache.ts`, the FE OpenF1 result fallback and the lock heuristic
- [ ] Keep `alpha.resultsIndex` direct for now
- [ ] Update polling to use `pollAfterMs` (or keep current cadence initially)

### Phase 5 — production verification

- [ ] Add Vercel rewrite
- [ ] Deploy frontend
- [ ] Verify `/api/results/...` through Vercel
- [ ] Verify `/api/status`
- [ ] Run through a practice session
- [ ] Confirm promotion when jolpica publishes
- [ ] Update README and this document's status

### Phase 6 — optional hardening

- [ ] ETag / CDN caching
- [ ] External uptime monitor
- [ ] Manual refresh endpoint
- [ ] Proxy results index/calendar
- [ ] Paid OpenF1 key if the free gap is still a problem

---

## 17. Suggested commit plan

On `feat/results-cache-worker`:

1. `worker: add cached results service skeleton`
2. `worker: fetch jolpica and cache session results`
3. `worker: add OpenF1 practice fallback and cron`
4. `web: read results from the cache worker`
5. `docs: document the results cache worker`

If the Worker and frontend switch feel safer as separate reviews, split into two branches:

- `feat/results-cache-worker` — Worker only, tested by curl.
- `feat/results-cache-frontend` — switch the app after the Worker is verified.

---

## 18. References

- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Cron Triggers: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Cloudflare KV: <https://developers.cloudflare.com/kv/>
- Vercel Hobby cron limits: <https://vercel.com/docs/cron-jobs/usage-and-pricing>
- jolpica-f1: <https://github.com/jolpica/jolpica-f1>
- OpenF1: <https://openf1.org/>

# Race Replay — Feature Plan

> Status: **implemented** (Phases 0–2). See [Implementation notes](#14-implementation-notes).
> Owner: Fabrizio · Created: 2026-10-18
> Folder note: this `docs/` folder is deliberately outside the Vite build (the build
> only bundles `index.html` + `src/` and copies `public/`), so this document is
> version-controlled but **never shipped** in `dist/`.

---

## 1. Goal

Add a **Replay** to the results view: a button that sits to the right of the session
selector in the *Chequered Flag* section, and opens a popup that animates a finished
race on the real circuit geometry — every car plotted in its team colour — with a
**live standings tower on the right** that updates as the replay plays.

The replay reads **free historical OpenF1 data** (no subscription required) and reuses
the app's existing visual language (team-coloured chips, cream panels, Archivo type).

---

## 2. Why this is feasible (evidence already gathered)

All figures below were measured against the live API and the Multiviewer circuit
endpoint on 2026-10-18, using the Singapore 2026 race (`session_key=11388`).

| Claim | Evidence |
| --- | --- |
| Car coordinates and circuit geometry share one frame | 51 real `/location` points sat a **mean of 2.6 m** from the Multiviewer outline polyline (min 0.0, worst-case 57.7 m, a glitch sample) |
| The browser can call OpenF1 directly | `Access-Control-Allow-Origin: *` on `api.openf1.org` (no proxy needed, unlike jolpica) |
| Current-season data is free | FAQ: live = **30 min before → 30 min after** a session; outside that it is free historical. A completed race is downloadable ~30 min after the flag |
| Circuit geometry is small and complete | Multiviewer `circuit_info` returns `x[]`, `y[]` (~544 pts), `rotation`, `corners[]`, `marshalSectors[]`, `pitLoss` — ~8 KB |
| Standings can animate from cheap data | `/position` for a full race = **396 rows / 46 KB**, each with a `date` |
| Traffic is not gzipped at rest but *is* gzipped on the wire | Response header `content-encoding: gzip` |

**The only hard problem is the size of the location feed**, not the capability — see §5.

---

## 3. Scope

### In scope (v1)

- Replay for **Race (`R`)** and **Sprint (`SR`)** sessions that have finished.
- Popup with: circuit map + moving cars, standings tower, playback controls.
- Free historical data only. Prototype reads OpenF1 directly; shipped version reads
  pre-baked assets.

### Explicitly out of scope (later phases)

- True live streaming (MQTT/WebSocket) — needs the paid tier + a backend token flow.
- Qualifying / practice replays (different "standings" semantics).
- Gaps, tyre compounds, flags, team radio, weather overlays.
- Any commercial use — OpenF1 is CC BY-NC-SA 4.0 (personal use only).

---

## 4. Architecture: prototype with A, ship with B

Both options feed the **same replay engine** — only the loader differs. This keeps the
renderer stable while the data source changes underneath it.

### Option A — on-demand fetch from OpenF1 (prototype)

- Browser calls `api.openf1.org` directly (CORS is open).
- Fetches ~22 driver-filtered `/location` responses + a few small endpoints.
- Downsample on ingest; cache in **IndexedDB** so repeat replays are instant.

**Pros:** zero infrastructure, works for any session 2023→now, fastest path to a visible
prototype.
**Cons:** several MB and ~22 requests per first replay; needs throttling + a progress UI.

### Option B — pre-baked static replay assets (shipped)

- A generation script fetches each finished race **once**, then:
  - downsamples location to ~2–4 Hz,
  - quantises x/y (integer metres),
  - simplifies polylines (Douglas–Peucker),
  - writes one compact file per race to `public/replays/{session_key}.json`.
- Expected ~**30–80 KB gzipped per race** (~1–2 MB per season).

**Pros:** one small file to load, instant replay, no rate-limit exposure, offline-capable,
no runtime third-party dependency.
**Cons:** a generation step (script + optional scheduled GitHub Action); assets live in the
repo.

### Decision

| Phase | Loader |
| --- | --- |
| Prototype (Phase 0–1) | **A** — OpenF1 direct, client downsample, IndexedDB cache |
| Ship (Phase 2+) | **B** — pre-baked static assets; A remains as a fallback for missing files |

The loader is behind one interface (`ReplaySource`) so switching A→B is a swap, not a rewrite.

---

## 5. Data sources

### 5.1 Endpoints and size (measured, Singapore 2026 race, 22 drivers)

| Piece | Endpoint | Size | Requests | Notes |
| --- | --- | --- | --- | --- |
| Circuit outline | Multiviewer `circuit_info` (or OpenF1 meeting's `circuit_info_url`) | ~8 KB | pre-bake | `x[]`, `y[]`, `rotation` |
| Drivers | `/v1/drivers?session_key=` | 5 KB | 1 | `driver_number`, `name_acronym`, `team_name`, `team_colour` |
| Positions | `/v1/position?session_key=` | 46 KB | 1 | timestamped → drives the tower |
| **Locations** | `/v1/location?session_key=&driver_number=` | **4.4 MB JSON / 2.1 MB CSV per driver** | **22** | the heavyweight; gzip on wire |
| Intervals (optional) | `/v1/intervals?session_key=` | 4 MB | 1 | gaps; heavy — defer |
| Laps | `/v1/laps?session_key=` | ~200 KB | 1 | lap counter, race distance and true start |
| Session window | `/v1/sessions?year=` | small | 1 | resolve `session_key`, start/end |

Estimated full-field wire cost (A): **~8–12 MB compressed**, ~700 k raw points across the
field. This is the number that forces Option B for the shipped version.

### 5.2 Circuit geometry pre-bake

- Fetch Multiviewer `circuit_info` once per circuit used, normalise to a small shape
  (`{ circuitKey, rotation, outline: [[x,y], …] }`), ship as `public/circuits.json`.
- Removes the runtime Multiviewer dependency and keeps the map instant.

### 5.3 Resolving jolpica round → OpenF1 session_key

The app's tables come from jolpica; OpenF1 is keyed by integers.

- Fetch `/v1/sessions?year={season}` once (cache for the session).
- Match the selected `Race` + `SessionCode` to an OpenF1 session by
  **year + session name + date proximity** (and `circuit_key` as a tiebreaker).
- Map `Race`/`SR` → OpenF1 session `Race`/`Sprint`.
- Expose a `resolveSessionKey(race, code)` that returns `number | null`.
- This join does not exist in the app today — it is the one genuinely new integration.

### 5.4 Availability rules (free tier)

- Data is free **outside** the window `[session_start − 30 min, session_end + 30 min]`.
- During a live session the replay must show a clear, non-error state:
  *"Replay will be available about 30 minutes after the chequered flag."*
- Rationale: the button always renders, but is disabled (with that hint) during the window.

---

## 6. Replay engine

Pure logic, no DOM. Unit-testable in isolation.

### 6.1 Coordinate transform (`src/lib/circuit.ts`)

1. Take `outline`, `rotation`, and the car points.
2. Rotate **both** by `rotation` degrees (same frame → they always agree).
3. Compute the outline bounding box, add padding, map into the SVG `viewBox`
   (uniform scale, y-flip if needed).
4. Memoise the transform per circuit.

Result: `toScreen(x, y) → { sx, sy }` used for outline and cars alike.

### 6.2 Timeline & interpolation (`src/lib/replay.ts`)

- Build a timeline `[t0, t1]` from the lap feed: `t0` is the first car's lap 1 start
  (lights out) and `t1` is the last recorded lap end. Locations before/after are cropped.
  Without laps, fall back to the scheduled session start and the latest location sample.
- Each driver's samples become `{ t, x, y }[]`, sorted by `t`.
- At playhead `t`: binary-search the bracketing pair per driver and **lerp** `x, y`.
- Filter out `x=0 && y=0` samples (garage / no-signal rows observed in the data).
- Advance with `requestAnimationFrame`; speed multiplier scales elapsed virtual time.

### 6.3 Standings tower

- From `/position`, keep each driver's timestamped position records.
- At playhead `t`: take the latest record ≤ `t` per driver, then sort → the tower order.
- It animates automatically through overtakes because records carry timestamps.
- Render with the existing `Position` chip + `team_colour`, plus acronym.

### 6.4 Optional enrichments

- [x] Leader lap counter and race distance from `/laps`.
- [ ] Gap from `/intervals`; tyre compounds; flags; retire/bring-back-state when a driver
  stops sending location.

---

## 7. UI / UX

### 7.1 Entry point

- A **Replay** button in `RaceResults`'s `panel__subhead`, right-aligned next to the
  session `Tabs`.
- Enabled when: selected session is `R`/`SR`, a `session_key` resolves, and the session
  has finished (+30 min). Otherwise disabled with an explanatory tooltip/inline hint.
- Add to the existing `.panel__subhead` a flex row: `Tabs` (left) · `Replay` (right).

### 7.2 Popup

- Reuse `Modal` (native `<dialog>`) — it already provides focus trap, `Esc`, backdrop.
- Add a **wide/full-screen variant** (new prop, e.g. `size="wide"`); keep the existing
  cream-panel styling.
- Layout (wide screens):
  - **Left / main:** SVG map (outline + car dots with acronyms).
  - **Right:** standings tower.
  - **Bottom:** transport bar.

### 7.3 Transport bar

- Play / pause.
- Speed: 1× / 2× / 4× / 8×.
- Scrubber spanning the session; shows elapsed / total.
- Leader lap counter, e.g. **Lap 23 / 56**, at the start of the transport.

### 7.4 States

- **Loading:** progressive ("Loading cars… 12/22") for Option A.
- **Live window:** disabled entry + hint (never a raw error).
- **Error / partial:** if some drivers fail, play with the rest and note the gap.
- Keyboard: space = play/pause, ←/→ = scrub; respect `prefers-reduced-motion`
  (start paused).

---

## 8. Rate limits, caching, performance

- Free tier: **3 req/s, 30 req/min**. A full-field race is ~22 location requests → throttle
  to stay under 30/min and show progress.
- **IndexedDB cache** keyed by `session_key` (Option A) so a replay is downloaded once.
- **Client downsample** on ingest (target ~2–4 Hz) to bound memory (~700 k points is not
  kept at full rate).
- Render with **SVG** first (≤ 22 dots — trivial). Move to Canvas only if trails are added.
- Option B removes the runtime concern almost entirely.

---

## 9. Phased plan

### Phase 0 — Prototype (Option A, standalone)

Goal: prove the map + moving dots + playhead against one hardcoded session.

- [x] `src/api/openf1.ts`: minimal client (direct to `api.openf1.org`).
- [x] `src/lib/circuit.ts`: transform + shape for one circuit.
- [x] `src/lib/replay.ts`: timeline, interpolation, standings-at-`t`.
- [x] Throwaway `<ReplayMap>` on a hidden route/flag, hardcoded to the Singapore 2026 race.
- [x] Verify cars sit on the outline across the whole lap and that the tower animates.

**Acceptance:** cars track the circuit for a full race; tower reorders at real overtakes.

### Phase 1 — Integrate (Option A)

Goal: the real feature, end to end, on free data.

- [x] `Replay` button in `RaceResults` + wide `Modal` variant.
- [x] `resolveSessionKey(race, code)` + `/sessions` cache.
- [x] Full loader: drivers + position + per-driver location; downsample; IndexedDB cache.
- [x] `ReplayMap`, `ReplayLeaderboard`, `ReplayControls`.
- [x] States: loading progress, live-window disabled, partial/error handling.
- [x] Accessibility pass (keyboard, ARIA, reduced motion).

**Acceptance:** from a finished race's results, Replay opens, loads, plays, scrubs, and the
tower tracks the race — with no subscription.

### Phase 2 — Ship on pre-baked assets (Option B)

Goal: fast, small, offline-capable.

- [x] `scripts/build-replays.mjs`: fetch → downsample → quantise → simplify → write
      `public/replays/{session_key}.json`.
- [x] `public/circuits.json` for all circuits in use.
- [x] `ReplaySource` abstraction with a B-first, A-fallback loader.
- [ ] Optional scheduled GitHub Action to bake new races after each weekend.
- [x] Budget check: per-file size, total asset weight.

**Acceptance:** a race replay loads from one static file, no OpenF1 calls at runtime.

### Phase 3 — Richness / live

- [x] Leader lap counter and race distance (`/laps`).
- [ ] Gaps (`/intervals`), tyre compounds, flags (`/race_control`).
- [ ] Qualifying / practice replays.
- [ ] True live via MQTT/WebSocket (paid tier + backend token flow) behind the same UI.

---

## 10. New / changed files (anticipated)

**New**

- `src/api/openf1.ts` — direct OpenF1 client + `resolveSessionKey`.
- `src/lib/circuit.ts` — geometry transform + shape cache.
- `src/lib/replay.ts` — timeline, interpolation, standings-at-`t`, source interface.
- `src/components/ReplayDialog.tsx` — dialog shell + layout.
- `src/components/ReplayMap.tsx` — SVG map + cars.
- `src/components/ReplayLeaderboard.tsx` — standings tower.
- `src/components/ReplayControls.tsx` — transport bar.
- `scripts/build-replays.mjs` — Option B generation (Phase 2).
- `public/circuits.json`, `public/replays/index.json`, `public/replays/*.json` — Option B
  assets (Phase 2).

**Changed**

- `src/components/RaceResults.tsx` — add the Replay button to `panel__subhead`.
- `src/components/Modal.tsx` — add a wide/full-screen variant.
- `src/index.css` — replay layout, map, tower, transport styling.
- `README.md` — document the feature and the OpenF1 credit.
- `vite.config.ts` — *likely unchanged* (OpenF1 needs no proxy; CORS is open).

---

## 11. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Location payload size | Slow/expensive first load | Option B assets; Option A downsample + IndexedDB |
| Rate limits (3/s, 30/min) | Failed burst fetch | Throttle, progress UI, cache, sequential fetch |
| Live-window unavailability | Confusing empty state | Explicit "available ~30 min after the flag" state |
| Round → session_key join | Wrong/missing session | Match on year + name + date; verify per round |
| Coordinate drift per circuit/season | Cars off the line | Spot-check each circuit; re-bake geometry per year |
| No lateral placement | Cars overlap in corners | Accepted; centreline view like a tracker |
| Pit lane off the racing line | Cosmetically off | Accepted for v1; optional pit path later |
| License (personal use only) | Can't be commercial | Keep hobby/non-commercial; note CC BY-NC-SA 4.0 |
| Reduced-motion users | Motion discomfort | Start paused; honour `prefers-reduced-motion` |

---

## 12. Open questions

1. **First cut scope** — `R` + `SR` only, or include qualifying from the start?
2. **Default speed** — start paused, or auto-play at 4×?
3. **Tower contents in v1** — position + acronym + team only, or attempt gaps immediately?
4. **Asset hosting (Phase 2)** — commit `public/replays/*.json` to the repo, or generate in CI?
5. **Credit** — add an OpenF1 mention in the footer alongside jolpica?

---

## 13. Appendix — measured API facts (2026-10-18)

- OpenF1 historical is free **from 2023 onwards, including the current season**.
- Live window = **session start − 30 min → session end + 30 min**.
- Free tier: **3 req/s, 30 req/min**; sponsor tier: 6 req/s, 60 req/min + up to 10
  concurrent MQTT/WS.
- `/location` without `driver_number` returns *"too much data at once"* — a driver filter
  is required.
- `api.openf1.org` returns `Access-Control-Allow-Origin: *`.
- Singapore 2026 race (`11388`): 22 drivers; one driver = 4.41 MB JSON / 2.12 MB CSV;
  `/position` = 396 rows; `/intervals` = 28,131 rows (4 MB).
- Multiviewer `circuits/61/2023`: 544 outline points, `rotation: 335`.

---

## 14. Implementation notes

Everything in Phases 0–2 shipped in the existing app structure; there is no hidden route or
feature flag. This section records where the build differs from the plan above.

### Deviations

- **Asset size is larger than estimated.** The plan guessed 30–80 KB gzipped per race. Real
  location feeds at 2 Hz are about 60 k points across the field, and the compact encoding
  still lands at **0.5–0.8 MB gzipped per race** (Singapore 2026: 1.58 MB raw, 22/22 cars,
  765 KB gzipped after cropping the pre-race feed). The estimate assumed a much more
  aggressive line simplification; the implemented encoding keeps every downsample point so
  cornering stays smooth. The full 2026 season is **29 MB raw / 11.5 MB gzipped**. They are
  served as individual files, so only the race being watched is downloaded.
- **Simplification is quantisation, not Douglas–Peucker.** Coordinates are rounded to whole
  metres and encoded as base36 zig-zag deltas (`dt.dx.dy`), which removes the need for a
  polyline simplifier and keeps interpolation deterministic. The circuit outline is rounded
  the same way.
- **The map uses the circuit endpoint's `rotation` directly.** Both the outline and the car
  points are rotated once in `src/lib/circuit.ts` and then y-flipped into SVG space. The
  first implementation rotated twice (outline and transform), which put cars off the track;
  that is fixed and noted here because the same mistake is easy to reintroduce.
- **Missing geometry degrades to a traced line.** Multiviewer returns 404 for Madring
  (`circuit_key=153`) and Kuala Lumpur (`12`), a known upstream gap. Rather than refusing
  those replays, the bake and the live fallback trace the fastest car's first lap
  (`traceOutline`) and mark the circuit `approximate`, so the map shows the driven line and
  the caption says so. All 23 finished 2026 sessions now have an asset.
- **The replay starts at lights out, not at the first location row.** OpenF1's location feed
  opens about forty minutes before the session, while the scheduled `date_start` includes
  the formation lap (and can be early for a delayed start). Both made the old 90th-percentile
  start show cars leaving the garages or touring to the grid. The bake and fallback now read
  `/laps`: the earliest lap 1 `date_start` is the race start, and the last recorded lap end is
  the finish. Location rows are cropped to that window before encoding, which also cuts the
  file size. Position records from before the start are kept so the tower has the opening
  order. Without laps, `replayWindow` remains the fallback.
- **The lap counter is the leader's lap.** Each lap begins when the first car crosses the
  line, so `Lap n` stays correct for lapped traffic even when a car's own lap row is later.
  Race distance is the highest lap number in the feed (Singapore 2026: 62). Lap starts are
  stored as `dt.lap` base36 frames, adding about 500 bytes per file. The transport renders
  `Lap n / total` and the replay opens on lap 1.
- **A local index keeps baked replays off OpenF1.** `public/replays/index.json` maps
  season + date + session code to the OpenF1 key, so a baked replay makes no third-party
  request at all. Without it the app still had to call OpenF1 `/sessions` just to discover
  which local file to open, which broke the Phase 2 acceptance criterion. The OpenF1 path
  remains for races that have not been baked.
- **The baked file embeds its own circuit.** `public/circuits.json` is written for reuse and
  inspection, but the runtime reads geometry from the replay file, so there is no second
  request and no version skew between the two.
- **IndexedDB fallback cache is versioned.** `CACHE_VERSION = 3`; bump it when the fallback
  payload shape changes (v3 adds the lap timeline and crops the pre-race window). Baked files are preferred over a cached fallback, so re-baking a race
  takes effect without clearing storage.

### Measured facts

- Singapore 2026 (`11388`): 22 drivers, all with usable location, replay window 1 h 43 m,
  1.58 MB raw / 765 KB gzipped, 22 tower entries, 62 laps.
- Fallback load on Monza 2026 (`11361`): ~90–120 s at 2.1 s per request on the free tier,
  cached after the first open.
- `public/replays/` contains every finished 2026 race and sprint (23 sessions, 21 with
  published geometry and 2 traced); 29 MB on disk, 11.5 MB gzipped in total.
- Build and lint pass with the new modules; the replay code adds no runtime dependencies.

### Follow-ups not done

- Scheduled baking (GitHub Action) after each weekend; today the assets are refreshed by
  running `npm run replays -- --season <year>`.
- Remaining Phase 3 richness (gaps, tyres, flags) and qualifying replays.
- A pit-lane path: cars on the pit lane are drawn on the racing line, as accepted in §11.

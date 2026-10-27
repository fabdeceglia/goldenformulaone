# Qualifying Battle (1v1) — Feature Plan

> Status: **implemented** (v1). See [Implementation notes](#13-implementation-notes).
> Owner: Fabrizio · Created: 2026-10-27
> Folder note: this `docs/` folder is outside the Vite build, so this document is
> version-controlled but never shipped in `dist/`.

---

## 1. Goal

Add a **1v1 battle** to a finished qualifying session: pick two drivers, pick a lap
for each (defaulting to their fastest), and open a popup that compares the two laps
side by side.

The screen should feel like the F1 "ghost" videos, adapted to data we actually have:

- a circuit map with both cars moving around the same lap,
- two cockpit-style telemetry panels (**speed, rpm, gear, throttle, brake, DRS**),
- a live gap at the current point of the lap,
- exact sector and lap deltas underneath,
- one shared transport (play, pause, scrub, speed).

No onboard video is involved. This is a **telemetry ghost**, not a video replay.

---

## 2. Why this is feasible (evidence gathered)

Measured against the live OpenF1 API on 2026-10-27, using Monza 2023 qualifying
(`session_key=9153`) and Leclerc's fastest lap (lap 20, `1:20.361`):

| Claim | Evidence |
| --- | --- |
| `car_data` has the exact channels we need | `speed`, `rpm`, `n_gear`, `throttle`, `brake`, `drs` |
| One lap is small | **297 rows / 50 KB** of `car_data`, **303 rows / 39 KB** of `location` |
| Sample rate is enough for a cockpit | ~3.7 Hz; 297 rows over 80.361 s |
| Lap boundaries are available | `/laps` gives `date_start`, `lap_duration`, `duration_sector_1..3`, `i1_speed`, `i2_speed`, `st_speed`, `is_pit_out_lap` |
| Qualifying sessions resolve with the existing join | `resolveSessionKey(race, 'Q' \| 'SQ')` already exists for the race replay |
| Browser access is fine | `api.openf1.org` sends `Access-Control-Allow-Origin: *` |
| Historical data is free | 2023→now; a session is downloadable about 30 minutes after the flag |

**The one hard problem is alignment, not data availability** — see §5.

### A query gotcha worth writing down

`date>=...&date<...` works when the operators are passed literally. Building the
query with `URLSearchParams` encoded `>=` as `%3D` and the API returned **HTTP 500**
for `car_data`. The battle client therefore formats the date window by hand:

```
/car_data?session_key=9153&driver_number=16
  &date>=2023-09-02T14:58:52.514&date<2023-09-02T15:00:12.875
```

Dates are UTC without a timezone suffix (`toISOString().slice(0, 23)`).

---

## 3. Scope

### In scope (v1)

- **Qualifying (`Q`)** and **sprint qualifying (`SQ`)** sessions that have finished.
- Two drivers, one lap each, from the same session.
- Lap picker defaulting to each driver's fastest timed lap; out-laps excluded.
- Cockpit telemetry, circuit map, live gap, sector/lap deltas, transport.
- OpenF1 on-demand fetching, throttled and cached in IndexedDB.
- Keyboard control and reduced-motion handling.

### Out of scope (later)

- Onboard video or a true split-screen TV picture.
- Cross-session comparisons (e.g. this year's pole vs last year's).
- More than two drivers.
- Live qualifying (paid OpenF1 tier).
- Pre-baked battle assets. The on-demand payload is small; bake only if it becomes
  a traffic concern.
- Steering, ERS, battery, tyre temperatures — OpenF1 does not publish them.
- A true racing-line comparison — `location` has no lateral placement.

---

## 4. Data sources

### 4.1 Requests per battle

| Piece | Endpoint | Requests | Notes |
| --- | --- | --- | --- |
| Session key | `/sessions?year=` (cached) | 0–1 | reuses `resolveSessionKey` |
| Drivers | `/drivers?session_key=` | 1 | codes, names, team colour |
| Laps | `/laps?session_key=` | 1 | every driver's lap refs |
| Circuit | Multiviewer `circuits/{key}/{year}` | 1 | ~8 KB, optional |
| Telemetry | `/car_data?session_key=&driver_number=&date>=&date<` | 2 | ~50 KB each |
| Location | `/location?session_key=&driver_number=&date>=&date<` | 2 | ~39 KB each |

Six to seven requests for a battle. At `SHORT_REQUEST_GAP_MS` (500 ms) the data
phase is about **2–3 s** on a cold load, instant from cache afterwards.

### 4.2 Never fetch an unfiltered driver session

One driver's full qualifying `car_data` is **2.88 MB / 17,405 rows**. The battle
window is the selected lap only, padded by about a second on each side. The
`location` endpoint gets the same window.

### 4.3 Lap selection

From `/laps?session_key=`:

- keep rows with `lap_duration > 0`,
- drop `is_pit_out_lap`,
- sort by lap number,
- default each side to the minimum `lap_duration`,
- rank the driver list by each driver's fastest lap, so the opening screen suggests
  the two quickest cars.

In-laps are not flagged by OpenF1; they are naturally buried by lap time. A lap
deleted for track limits is also not flagged, so the picker is the source of truth
rather than a claim about official results.

---

## 5. Battle engine

Pure logic in `src/lib/battle.ts`, no DOM. Same approach as `src/lib/replay.ts`.

### 5.1 Normalise both laps to elapsed time

Both laps happen at different wall-clock times, so absolute timestamps are useless
for comparison.

1. Take the lap's `date_start` and `lap_duration`.
2. Keep `car_data` / `location` rows in `[date_start, date_start + lap_duration]`.
3. Convert each row to `t = Date.parse(date) - date_start` (milliseconds).
4. Add an anchor at `t = 0` (first sample's values) and `t = duration` (last
   sample's values) so the cockpit and the distance integral cover the full lap,
   even when the first feed row lands ~270 ms after the line.
5. Resample every channel at the playhead with linear interpolation. Discrete
   channels (gear, brake, DRS) take the previous sample instead of blending.

The lap duration itself is exact from `/laps`; only the start instant is
approximate (OpenF1 documents `date_start` as approximate).

### 5.2 Live gap: same point on track, two different times

The gap shown while playing is **not** a raw timestamp difference. It is the time
difference at the same distance around the lap:

1. Integrate `speed` over time on each lap (trapezoid, km/h → m/s) to get a
   cumulative distance curve `d(t)`.
2. Normalise each lap by its own total distance, so `progress = d / total` runs
   from 0 at the line to 1 at the finish.
3. At playhead `t`, take the **leading** progress `p = max(progressA, progressB)`.
4. Invert each lap's curve to get `timeAt(p)`.
5. `delta = timeA(p) − timeB(p)`. Negative means A reached that point first.

This is exactly the ghost-video question: *at the same place on track, who is
ahead and by how much time?* At the end of both laps the result converges on the
exact lap-time difference, because `timeAt(1) = lap_duration`.

Speed integration is an approximation, but the error is mostly common to both
laps and the final value is pinned by the known lap time. The UI labels it as a
live estimate.

### 5.3 Exact deltas

`sectorDeltas(a, b)` uses `duration_sector_1/2/3` from `/laps` and the exact lap
duration. These are the trustworthy numbers in the sector table; the telemetry gap
is for the moving picture.

### 5.4 Circuit fallback

If the Multiviewer geometry is missing (Madring, Kuala Lumpur), trace the outline
from one battle lap's `location` samples using the existing `traceOutline`, and mark
the circuit `approximate`. The map then says the line was traced from the car.

---

## 6. UI / UX

### 6.1 Entry point

- A **1v1 Battle** button in `RaceResults`'s `panel__subhead`, next to the session
  tabs, for `Q` and `SQ` only.
- Same availability rule as the race replay: the session must be finished plus
  thirty minutes, so OpenF1's free historical window is open.
- The existing **Replay** button stays for `R`/`SR`. Other sessions keep the
  disabled Replay button with its explanation.

### 6.2 Setup step

- Two driver slots, A and B, each with a driver select and a lap select.
- Defaults: the two drivers with the best laps, each on their fastest lap.
- The same driver cannot occupy both slots; the selected driver is disabled in the
  other list.
- Lap options show `L20 · 1:20.361`; the fastest is marked.
- **Start battle** is enabled only when both slots have a driver and a lap.
- A note explains that the data comes from OpenF1 and the lap start is approximate.

### 6.3 Battle step

Wide modal, a two-column stage under the scoreboard:

1. **Scoreboard** — driver chips (team colour, acronym, lap time) with the live gap
   and the exact lap delta in the middle.
2. **Stage** — the track and the cockpit telemetry share the same row so the eye
   does not travel between them:
   - **Left column:** the **track** (circuit outline with both cars ghosted in team
     colour and a start/finish progress ribbon per driver), with the **sector
     table** directly underneath (S1/S2/S3/LAP, both times, faster split
     highlighted, delta relative to driver A).
   - **Right column:** the two **cockpits** stacked:
     - speed (large, km/h) and gear,
     - rpm value and bar,
     - throttle bar, brake bar, DRS state,
     - a **Finished** badge once that lap's playhead passes its duration.
3. **Transport** — play/pause, scrubber, elapsed/total, 0.5×/1×/2×/4×, and
   **Change drivers** at the far end of the row. The transport stays visible on a
   short laptop screen, where the footer hint would otherwise fall below the fold.

### 6.4 States

- **Loading session:** progressive ("Loading the field…", "Loading the laps…").
- **Loading battle:** "Loading LEC's telemetry… 2/4".
- **Unavailable:** explicit "Battle is available for finished qualifying sessions."
- **Partial telemetry:** if one channel is missing, show `—` for it rather than
  failing the whole battle. If a lap has no telemetry at all, show a retryable
  error.
- **Reduced motion:** open paused when `prefers-reduced-motion: reduce`; otherwise
  start playing automatically.
- **Keyboard:** space toggles, ←/→ scrubs one second.
- **Responsive:** below 720px the stage becomes one column (track, cockpits,
  sectors). On a short two-column viewport the map uses a wider frame so the whole
  battle, including the transport, fits on one screen.

---

## 7. Files

### New

| File | Purpose |
| --- | --- |
| `src/lib/battle.ts` | lap refs, normalisation, interpolation, distance/ghost gap, sector deltas |
| `src/lib/battleSource.ts` | session + battle loader, circuit fallback, cache integration |
| `src/lib/battleCache.ts` | IndexedDB cache keyed by session + both driver/lap pairs |
| `src/components/BattleDialog.tsx` | setup, loading, battle layout, playhead, keyboard |
| `src/components/BattleCockpit.tsx` | one driver's telemetry panel |
| `src/components/BattleTrack.tsx` | circuit map, ghost cars, progress ribbon |
| `src/components/BattleControls.tsx` | battle transport bar |

### Changed

| File | Change |
| --- | --- |
| `src/api/openf1.ts` | add `OpenF1CarData`, `carData`, date-bounded `location`, optional gap on `laps` |
| `src/components/RaceResults.tsx` | add the 1v1 Battle button and dialog for `Q`/`SQ` |
| `src/index.css` | battle setup, scoreboard, map, cockpits, sectors, transport, responsive rules |
| `README.md` | document the feature, API usage and the alignment caveat |

---

## 8. Phases

### Phase 0 — Engine

- [x] `battle.ts` types + lap refs.
- [x] Normalise telemetry/location to lap-elapsed time.
- [x] Interpolation, distance curve, live gap, sector deltas.
- [x] `openf1.carData` + date-bounded `location`, with the literal-operator rule.

**Acceptance:** two real laps produce plausible speed/gear traces, a 0.000 gap at
the line, and a final gap equal to the lap-time difference.

### Phase 1 — Loader and UI

- [x] `battleSource.ts`: resolve session, rank drivers, load two laps, cache.
- [x] Setup step with defaults and lap picker.
- [x] Battle step: scoreboard, map, two cockpits, sectors, transport.
- [x] Loading/error/partial states.
- [x] Entry point in `RaceResults` for `Q`/`SQ`.

**Acceptance:** from a finished qualifying classification, 1v1 Battle opens, offers
the two fastest drivers by default, loads both laps, and plays/scrubs with live
telemetry.

### Phase 2 — Polish

- [x] Reduced-motion start state.
- [x] Keyboard shortcuts.
- [x] Responsive cockpit stacking.
- [x] Documentation and measured notes.

**Later:** pre-baked battle assets, a telemetry trace overlay tab, cross-session
comparisons.

---

## 9. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `date_start` is approximate | Small sync offset between laps | Normalise to lap start; use exact sector times for the authoritative deltas |
| Accelerated/encoded filter operators | 500 errors on `car_data` | Build the date query literally; never pass operators through `URLSearchParams` |
| Full-session payload | Multi-MB downloads | Always bound by the selected lap's `date_start`/`lap_duration` |
| No lateral position | Both cars sit on the same line | Accepted; the map is a ghost tracker, and the progress ribbon carries the gap |
| Deleted laps not flagged | A deleted fastest lap can be selected | The picker is explicit; the sector/lap times come from OpenF1 as-is |
| Missing telemetry rows | Empty cockpit fields | Per-channel `—`, partial laps still play; only a fully empty lap errors |
| Rate limits (3/s, 30/min) | Slow cold load | 500 ms gap, six requests, IndexedDB cache |
| Lap time vs integrated distance | Slightly off mid-lap live gap | Label as a live estimate; exact lap/sector deltas shown separately |
| License | Can't be commercial | Personal/non-commercial use; OpenF1 is CC BY-NC-SA 4.0 |

---

## 10. Decisions

1. **Same session only in v1.** Different sessions would need a common circuit
   frame and a different title; not worth the complexity now.
2. **On-demand, not baked.** A battle is ~180 KB for four responses. Baking every
   driver's every lap would dwarf the race replay assets.
3. **Two time bases, clearly separated.** The map/cockpits use lap-elapsed time;
   the sector table uses official sector times.
4. **No fake telemetry.** Only channels OpenF1 publishes. The cockpit does not draw
   a steering wheel it cannot animate.
5. **Start playing automatically**, except for reduced-motion users.

---

## 11. Open questions

1. Should the setup screen offer a "compare to pole" preset in addition to the two
   fastest drivers?
2. Should the battle view include a speed/throttle trace graph tab, or is the
   cockpit enough?
3. Is a five-second replay loop (the last corner) useful after the first watch?
4. Do we want to bake only the **fastest lap** per driver after the feature proves
   popular? It would cut the cold load from six requests to one file.

---

## 12. Appendix — measured API facts (2026-10-27)

- Monza 2023 qualifying: `session_key=9153`, 20 drivers, 21 laps for car 16, 19 timed.
- Leclerc lap 20: `lap_duration=80.361`, sectors `26.667 / 27.101 / 26.593`,
  `i1_speed=307`, `i2_speed=277`, `st_speed=298`.
- `car_data` for that lap: 297 rows, ~50 KB; `location`: 303 rows, ~39 KB.
- Unfiltered `car_data` for one driver in the session: 17,405 rows, 2.88 MB.
- `drs` observed values: `8` (eligible), `12`/`14` (on); `brake` is `0` or `100`.
- Combining `date>=` and `date<` with URL-encoded operators → **HTTP 500**;
  literal operators → **HTTP 200**.

---

## 13. Implementation notes

The feature shipped in the existing app structure: no hidden route and no feature
flag. The engine is deliberately separate from the race replay because the data
shape is different (lap-relative telemetry, not a whole-field timeline).

### Deviations

- **The live gap uses an integrated speed curve, not map arc length.** It is
  cheap, monotonic, needs no circuit projection and converges on the exact lap
  delta at the finish. The trade-off is a mid-lap estimate rather than a measured
  distance; the sector table remains the exact reference.
- **No baked assets in v1.** The measured four-response payload is about 180 KB
  for a battle, so the extra build step and a second asset family were not worth
  it. `battleCache.ts` makes repeat battles instant.
- **A separate IndexedDB database.** Battles use `box-this-lap-battles` rather
  than bumping the replay database version, so the two caches cannot block or
  upgrade each other.
- **The map and cockpit are pure views of `current`.** There is no separate battle
  clock; the dialog owns one playhead in lap-elapsed milliseconds, exactly like
  the race replay owns one epoch playhead.
- **Out-laps are filtered, in-laps are not.** OpenF1 has no in-lap flag; the lap
  picker ranks by time and lets the visitor choose, rather than guessing.
- **A failed circuit request degrades.** The battle traces the faster lap's driven
  line and marks the map approximate, matching the race replay's Madring strategy.
- **Partial telemetry is tolerated.** Channels are nullable; a cockpit renders
  `—` for a missing value instead of refusing a lap. A lap with fewer than two
  telemetry samples is a hard error.
- **The setup lists only drivers with a timed lap.** A session with fewer than two
  of them is a `BattleUnavailableError` rather than an empty picker. The ranking
  and the default picks both come from `fastestLap`.
- **The battle map is shorter than the replay map.** `prepareCircuit` grew an
  optional `viewHeight` (430 for the battle, the 720 default for the replay), so
  the map and two cockpits fit in one dialog without a second geometry module. On
  a two-column viewport under 880px high it drops to 355, which keeps the whole
  battle — transport included — on one laptop screen.
- **The stage is two columns, not a vertical stack.** Track and sector table sit
  left, the two cockpits right, so the circuit and telemetry are followed without
  moving the eyes up and down. Below 720px it falls back to a single column.
- **The faster car finishes first.** The playhead runs to the slower lap, so the
  leading cockpit shows its **Finished** badge while the other car is still
  running. That is the ghost-video behaviour and needs no extra state.
- **Reused classes, not copied CSS.** The battle reuses `replay__head`,
  `replay__figure`, `replay__map-shell`, `replay__map`, `replay__transport` and the
  loading/progress styles. `BattleControls` is a thin wrapper because a lap is
  watched at 0.5×–4×, not skimmed at the replay's 16×.

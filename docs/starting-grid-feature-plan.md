# Starting Grid View — Feature Plan

> Status: **planning**. No implementation yet.
> Owner: Fabrizio · Created: 2026-10-18
> Folder note: `docs/` sits outside the Vite build (the build only bundles
> `index.html` + `src/` and copies `public/`), so this document is version-controlled
> but **never shipped** in `dist/`.

---

## 1. Goal

Add an **alternative presentation of qualifying results** — a "Starting Grid" view —
styled after the *Starting Grid* screen in the game
[Golden Lap](https://www.funselektor.com/goldenlap) (the fourth image in their gallery).

Instead of the current one-row-per-driver table, qualifying (`Q`) and sprint qualifying
(`SQ`) can be shown as a **two-column, staggered grid of plates**: team-coloured number
badges, the driver's name over their team, and the actual starting order at a glance.

The feature is **purely presentational**. It reuses the qualifying payload the app already
fetches — no new endpoint, no new network call.

---

## 2. The reference screen

The Golden Lap *Starting Grid* is a static, stylised rendering of the qualifying
classification:

- **Two staggered columns** — odd positions on the left, even on the right, each
  right-hand plate dropped half a row to mimic a physical grid.
- **Per-entry plate** with a **team-coloured circular number badge**, driver name (bold)
  and team name (smaller), plus a cluster of small **trait/perk icons** on the right.
- A few plates outlined in **red** (in-game, the player's own teams).
- A "CONTINUE" footer.

Only two elements are game-specific: the **trait icons** and the **player-team outline**.
Everything else maps directly onto real qualifying data.

---

## 3. Why this is feasible (evidence gathered)

All figures measured against the live jolpica alpha API on **2026-10-18**, using the
finished 2026 Singapore Grand Prix qualifying (round 17, round id `round_K2Oe8smo` was the
*upcoming* US GP and returned empty results — a good reminder that a future round has no
classification yet).

| Claim | Evidence |
| --- | --- |
| Qualifying is one already-fetched call | `GET /f1/alpha/results/{round_id}/Q/` — the exact payload `RaceResults` already loads |
| Grid order is present | each entry carries `position` (1…22) and `position_text` |
| Team colour + number are present | `team.primary_color` (exact hex, e.g. `#4781D7`) and `car_number` |
| Driver + team names are present | `driver.given_name`/`family_name`/`abbreviation`; `team.name` |
| Segment participation is present | `components.Q1/Q2/Q3` each with `position` + `time` |
| NC / retired states are present | R17 `position_text` includes `NC`; `status` ∈ {`FINISHED`, `RETIRED`} |
| The staggered layout needs no data | it is pure CSS |
| **No sector times exist anywhere** | `/Q/sectors/` and `/Q/laps/` both **404** |
| Lap-by-lap *does* exist (bonus) | `GET /f1/alpha/core/laps/?session_id=…` → `number`, `time_display`, `time_milliseconds`, `is_entry_fastest_lap` (no sectors) |

**Conclusion:** the *Starting Grid* is the **most feasible** of the Golden Lap screens — it
is a static layout over data we already have. The live-timing screen (`Qualifier2`) is
**not** achievable: it needs sectors, tyre compounds, in/out-lap states and live car
positions on a track map, none of which exist in this API.

---

## 4. Scope

### In scope (v1)

- A **view toggle** in the *Chequered Flag* section, visible only when the selected session
  is `Q` or `SQ`.
- A new **Starting Grid** presentation: two staggered columns of plates in the app's
  paper-and-ink theme.
- Derived, real-data details: gap to pole, per-segment participation, NC/retired handling.
- Responsive collapse to a single column on narrow screens; accessible ordered-list
  semantics.

### Explicitly out of scope

- Sector splits, tyre compounds, in/out-lap/pit states — **not in the API**.
- Any live/telemetry track map.
- The trait/perk icons from the game (no equivalent data).
- Replay-style animation.
- Rebuilding the *race* starting grid from `GRID` (possible later; see §12 Q4).

---

## 5. Data model and mapping

Source type: `AlphaSessionResults` / `AlphaSessionEntry` in `src/api/types.ts`
(unchanged — no type changes required).

| Screen element | Real source | Notes |
| --- | --- | --- |
| Grid order | `entry.position` (fallback: array order) | |
| Number badge colour | `entry.team.primary_color` | reuse `readableInk()` for text contrast |
| Number badge value | `entry.car_number` (fallback `position`) | car number reads better than the grid slot |
| Driver name | `entry.driver.given_name` + `family_name` | `abbreviation` as the compact option |
| Team name | `entry.team.name` | |
| Gap to pole | `parseSessionTime(entry.time)` vs P1 | reuse `formatGap()` |
| Segment participation | `entry.components.Q1/Q2/Q3` | present ⇒ set a time that segment |
| NC / retired | `entry.position_text === 'NC'` / `status === 'RETIRED'` | pull out of the 20 slots |

**Segments per session code** (mirror the existing `SEGMENT_COLUMNS` map):
`Q` → `Q1/Q2/Q3`; `SQ` → `SQ1/SQ2/SQ3`.

**The one gap — the icon cluster.** The game's perk icons have no data equivalent.
Recommended substitute: **one dot per segment** (filled = set a time, hollow = eliminated),
plus the **gap to pole**. Alternatives in §12 Q2.

---

## 6. Architecture

Presentational only. Nothing new is fetched.

```
RaceResults (Chequered Flag)
  ├─ session Tabs  ───────────────► selects Q / SQ / …
  ├─ view toggle (Table | Grid) ─► local state, shown only for Q / SQ
  └─ SessionResultTable(session)  ─► current behaviour
       └─ StartingGridView(session) ─► new, when the Grid view is active
```

- **`src/lib/grid.ts`** (new) — pure helpers, unit-testable, no DOM:
  - `gridRows(results)` → ordered entries + a trailing "did not qualify" bucket.
  - `columnSplit(entries)` → `{ left: odd positions, right: even positions }`.
  - `segmentParticipation(entry, segments)` → `boolean[]`.
  - `gapToPole(entry, leaderTime)` → string (wraps `parseSessionTime` + `formatGap`).
- **`src/components/StartingGridView.tsx`** (new) — renders the two columns of plates.
  Reuses the `Position` chip idea (team colour + `readableInk`) for the number badge.
- **Toggle placement** — a small `Tabs`-style or button-group control. Simplest: render it
  from `RaceResults` in the existing `.panel__subhead` (right-aligned, mirroring the
  Replay-button pattern already planned for that row), and pass the chosen view down.
- **State** — a single `useState<'table' | 'grid'>('table')`, reset per session is fine;
  persistence is an open question (§12 Q6).

No changes to `alpha.ts`, `types.ts`, `vite.config.ts` or the proxy layer.

---

## 7. UI / UX

### 7.1 Layout

- Two columns; **left = odd grid slots, right = even**, right column offset by half a row
  (`transform: translateY(50%)` on the even column, or a CSS grid with an offset row).
- Each plate: number badge · driver name / team name · detail cluster (segment dots + gap).
- The **leader plate** emphasised (the game gives P1 a heavier plate).
- The screen is static — no animation, so `prefers-reduced-motion` is satisfied by default.

### 7.2 Visual language

Keep it in the app's **paper & ink** system rather than the game's frosted glass:

- plates as cream (`--paper-raised`) with a hard `box-shadow` and a `--line` edge,
- team colour used only in the number badge (exactly how `Position` behaves today),
- display type in Archivo condensed caps for the plate's secondary line,
- the red outline repurposed to a real meaning (see §12 Q3).

### 7.3 States

| State | Behaviour |
| --- | --- |
| Loading / error | unchanged — `RaceResults` already handles these before rendering the view |
| Empty results | unchanged — existing `Empty` message (e.g. a future round) |
| Session is `FP*` or `R`/`SR` | toggle hidden; table only |
| `NC` / `RETIRED` entries | rendered **after** the 20-slot grid as a "did not qualify" strip |
| Sprint qualifying | identical treatment, `SQ1/SQ2/SQ3` labels |

### 7.4 Accessibility

- The grid is decorative in *layout* but real in *order*: render as an `<ol>` so the
  reading order is the classification order, with the stagger purely presentational.
- The number badge is aria-hidden if the position is already announced by the list item.
- Toggle is a real button group with `aria-pressed`, or a `Tabs` variant.

### 7.5 Responsive

- `< ~640px`: collapse to a **single ordered column** (position order). The stagger is a
  wide-screen affordance only.

---

## 8. Phased plan

### Phase 0 — Static prototype

Goal: prove the layout against one hardcoded session.

- [ ] `src/lib/grid.ts`: `gridRows`, `columnSplit`, `segmentParticipation`, `gapToPole`.
- [ ] `src/components/StartingGridView.tsx`: two columns of plates, no toggle yet.
- [ ] Drop it in behind a temporary flag, hardcoded to the 2026 Singapore `Q` payload.
- [ ] Verify the stagger, badges, names and NC strip read correctly.

**Acceptance:** a completed qualifying renders as a legible staggered grid.

### Phase 1 — Integrate

Goal: the real feature, end to end, from existing data.

- [ ] View toggle in `RaceResults` (`.panel__subhead`), shown only for `Q`/`SQ`.
- [ ] Wire the toggle to render `StartingGridView` or `SessionResultTable`.
- [ ] Segment dots + gap-to-pole in the plate detail cluster.
- [ ] NC / retired strip.
- [ ] Accessibility pass (ordered list, toggle semantics).

**Acceptance:** selecting qualifying offers a Table/Grid switch; the grid matches the
classification and needs zero new fetches.

### Phase 2 — Polish / extend

- [ ] Responsive single-column fallback.
- [ ] Decide and implement the red-highlight meaning.
- [ ] Optional: reuse the same plates for the **race** starting grid (`GRID` component).
- [ ] Note the view in `README.md`.

---

## 9. New / changed files (anticipated)

**New**

- `src/lib/grid.ts` — pure derivation helpers.
- `src/components/StartingGridView.tsx` — the staggered grid.

**Changed**

- `src/components/RaceResults.tsx` — view toggle + conditional render.
- `src/components/SessionResultTable.tsx` — only if the toggle lives here instead.
- `src/index.css` — grid layout, plates, number badge, responsive fallback.
- `README.md` — document the alternative view.

**Unchanged (deliberately)** — `src/api/alpha.ts`, `src/api/types.ts`,
`src/lib/format.ts` (reused), `vite.config.ts`.

---

## 10. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| No true "sectors" | Can't mirror the timing screen | Accepted; use segments as the detail instead |
| No perk-icon equivalent | Fidelity gap | Replace with segment dots + gap to pole |
| No "player team" concept | Red outline is meaningless | Repurpose it (pole / Q3 advancers) or drop it |
| 22 entries vs 20 slots | Miscount vs a real grid | Explicit "did not qualify" strip for `NC`/retired |
| Stagger on narrow screens | Readability loss | Single-column fallback < 640px |
| Toggle clutter | Two controls in one header | Only render the toggle for `Q`/`SQ` |
| Future round has empty results | Blank grid | Existing `Empty` state already covers it |

---

## 11. Open questions

1. **Toggle placement & wording** — "Table / Grid", a segmented control vs `Tabs`? In
   `RaceResults` next to the session tabs, or inside `SessionResultTable`?
2. **Detail cluster** — segment dots + gap (recommended), or just the gap, or the car number?
3. **Red highlight** — pole only, all Q3 advancers, a favourite driver, or drop it?
4. **Race sessions too?** — show a starting grid for `R`/`SR` from the `GRID` component, or
   keep this strictly a qualifying view?
5. **Default view** — table first (current) or grid first when the session is qualifying?
6. **Persistence** — remember the chosen view across sessions/rounds (localStorage), or
   per-session only?
7. **20 vs 22** — a trailing strip, or a separate "DNQ" column?

---

## 12. Appendix — measured API facts (2026-10-18)

- Qualifying results: `GET /f1/alpha/results/{round_id}/Q/`.
  Top-level keys: `code, title, sessions[], timestamp, local_timestamp, timezone, season,
  round, circuit, component_keys, results[]`.
  `component_keys` = `["Q1","Q2","Q3"]`.
- Entry keys: `driver, team, position, position_text, time, is_classified, status,
  car_number, components`.
  `components.{Q1,Q2,Q3}` = `{ key, name, position, time }`.
- Singapore 2026 `Q`: **22 entries**; `status` ∈ {`FINISHED`, `RETIRED`};
  `position_text` ∈ {`1`…`21`, `NC`}; the `NC` entry has `time: null`.
- `sessions[]` inside the `Q` payload lists the sub-sessions with ids
  (`type`: `Q1`/`Q2`/`Q3`, e.g. `session_UKGSNyjM`).
- Alpha API index: `schedules, laps, core/{seasons,rounds,circuits,drivers,teams,sessions,
  session-entries,laps,pit-stops}`.
- Laps: `GET /f1/alpha/core/laps/?session_id={id}` → per lap
  `{ number, time (PT1M35.482S), time_display (1:35.482), time_milliseconds,
  is_entry_fastest_lap, session_entry }`. Paginated 100/page (166 laps for Q1).
  `session_id` is the required filter — `session` and `page_size` are rejected (400).
- **No sector data exists**: `/Q/sectors/`, `/Q/laps/`, `/Q/components/` → **404**.
- A round in the future returns an empty `results[]` (its `timestamp` is still ahead).

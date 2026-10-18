# Starting Grid View — Feature Plan

> Status: **implemented** (2026-10-18). See §13 for what shipped and which open
> questions were answered.
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
  - `gridRows(results)` → the grid entries in order + a trailing "did not qualify" bucket.
  - `segmentParticipation(entry, segments)` → `boolean[]`.
  - `gapToPole(entry, leaderTime)` → string (wraps `parseSessionTime` + `formatGap`).
  - `QUALIFYING_SEGMENTS` → the segment codes, shared with the table so the two cannot
    drift.
- **`src/components/StartingGridView.tsx`** (new) — renders the two columns of plates.
  Reuses the number-badge idea (team colour + `readableInk`).
- **Toggle placement** — a small button group rendered from `RaceResults` in the existing
  `.panel__subhead`, right-aligned with `margin-left: auto`.
- **State** — a single `useState<'table' | 'grid'>('table')`, no persistence.

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

> Folded into Phase 1: the layout was proven against live qualifying instead of a hardcoded
> payload, so there was no throwaway flag to add and remove.

- [x] `src/lib/grid.ts`: `gridRows`, `segmentParticipation`, `gapToPole` (+ `QUALIFYING_SEGMENTS`).
- [x] `src/components/StartingGridView.tsx`: two columns of plates.
- [x] Verify the stagger, badges, names and NC strip read correctly.

**Acceptance:** a completed qualifying renders as a legible staggered grid.

### Phase 1 — Integrate

Goal: the real feature, end to end, from existing data.

- [x] View toggle in `RaceResults` (`.panel__subhead`), shown only for `Q`/`SQ`.
- [x] Wire the toggle to render `StartingGridView` or `SessionResultTable`.
- [x] Segment dots + gap-to-pole in the plate detail cluster.
- [x] NC / retired strip.
- [x] Accessibility pass (ordered list, toggle semantics).

**Acceptance:** selecting qualifying offers a Table/Grid switch; the grid matches the
classification and needs zero new fetches.

### Phase 2 — Polish / extend

- [x] Responsive single-column fallback.
- [x] Decide and implement the red-highlight meaning (pole).
- [ ] Optional: reuse the same plates for the **race** starting grid (`GRID` component).
- [x] Note the view in `README.md`.

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

---

## 13. Implementation notes (2026-10-18)

Shipped in one pass, Phase 0 folded into Phase 1 (the layout was proven directly against
live qualifying rather than a hardcoded payload).

**Files**

- `src/lib/grid.ts` — `gridRows`, `gapToPole`, `segmentParticipation`, `QUALIFYING_SEGMENTS`.
- `src/components/StartingGridView.tsx` — the plates and the did-not-qualify strip.
- `src/components/RaceResults.tsx` — the toggle and the conditional render.
- `src/components/SessionResultTable.tsx` — now imports `QUALIFYING_SEGMENTS` instead of
  keeping its own copy, so the table and the grid read the segments off one map.
- `src/index.css` — `.view-toggle`, `.grid*`, `.plate*`, plus the `≤640px` single-column
  fallback.
- `README.md` — "The Starting Grid" under *Session results*.

**Open questions, answered**

| # | Question | Decision |
| --- | --- | --- |
| 1 | Toggle placement & wording | `Table / Grid`, a `role="group"` of `aria-pressed` buttons, right-aligned in `.panel__subhead` |
| 2 | Detail cluster | Segment dots + gap to pole; the pole plate prints the pole time, since its own gap would be zero |
| 3 | Red highlight | Pole only: the heavier plate, and its slot label in red |
| 4 | Race sessions too? | Not now — qualifying only, as scoped |
| 5 | Default view | Table, unchanged |
| 6 | Persistence | None — component state, no `localStorage` |
| 7 | 20 vs 22 | A trailing "Did not qualify" strip outside the `<ol>` |

**Deviations from the plan, and why**

- **No `columnSplit`.** With `grid-template-columns: repeat(2, 1fr)` and the default
  `grid-auto-flow: row`, DOM order 1…N already places odd slots left and even slots right, so
  the split is free. Keeping one ordered list is what lets the reading order stay the
  classification order while the stagger is done entirely in CSS.
- **Slots are renumbered 1…N in grid order**, not taken from `entry.position`. Singapore's
  *sprint* qualifying has two cars marked `NC` at API positions 9 and 10; using the API's
  numbers would have produced P1–P8 and P11–P22 with a hole in the middle. A real grid closes
  up behind an excluded car, so the grid is renumbered and the excluded cars drop to the
  strip. Where nothing is excluded the two agree.
- **The slot label sits beside the badge.** The plan put the car number on the badge, which
  is right for the Golden Lap look, but a grid whose order is only implied is worse than one
  that states it, so each plate also carries `P1`, `P2`, … The badge is `aria-hidden` (a bare
  number is ambiguous out of context); the slot label is not.
- **A button group, not a `Tabs` variant.** The session bar already holds a `role="tablist"`;
  a second tablist in the same row would make the session tabs sound like they switch panels.

**Verified** — `npm run build`, `npm run lint`, and `grid-check.mjs` (47 assertions: the
toggle's visibility rules, the grid drawn with no new request, classification order and the
interlock, plate contents including the pole time taken from the table, segment dots, the NC
strip, list/toggle semantics, sprint qualifying renumbering, the phone single-column fallback
and no sideways scroll, console clean), plus screenshots at 1280, 390 and 320 px.

**Still open** — the race/sprint `GRID` reuse (§12 Q4), and whether the strip should show a
reason (`RETIRED`) rather than a bare `NC`.

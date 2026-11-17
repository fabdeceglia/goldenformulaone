# Off-Season Hero — Feature Plan

> Status: **planning**. No implementation yet.
> Owner: Fabrizio · Created: 2026-11-17
> Folder note: `docs/` sits outside the Vite build (the build only bundles
> `index.html` + `src/` and copies `public/`), so this document is version-controlled
> but **never shipped** in `dist/`.

---

## 1. Goal

The season ends in Abu Dhabi. From that moment until the 2027 pre-season test, the
landing page has no next event to lead with — but the app should not look finished.

Replace the dead-end "Season finale" hero with a **season review hero**: a summary of
the season that just ended, built from data we already fetch, whose primary action
hands the visitor to the comparison feature. When the 2027 test sessions begin, a
dedicated testing hero takes the same slot (separate plan, see §9).

The hero slot is the same. The layout is the same two columns. What changes is the
subject: from *"the next event"* to *"the season that was"*.

---

## 2. Current behaviour, and why it reads as broken

Traced in the code, not inferred:

- `App.tsx:9-21` fetches `api.currentRaces` (`/current/races/?limit=100`) and renders
  `SeasonView` with the calendar. There is no season pinning.
- `src/lib/schedule.ts:92-102` — `findFeaturedEvent` returns the live/race-day round,
  else the first upcoming round, else **`events[events.length - 1]`**.
- `FeaturedEvent.tsx:25-156` renders that last round with `hero--final`, the badge
  **"Season finale"** and the caption **"Season complete"** (`README.md:508-560`
  documents this as intentional: "the final round is shown as the Season finale so the
  layout stays consistent").

So after the last race the hero still advertises a finished weekend: full weekend
schedule, "Finished" chips, a "Circuit info" button, and no path to anything that
summarises the year. It is a race-weekend hero with nothing left to race.

`featured` is only ever `null` when the calendar is empty, so an off-season state
cannot be expressed by the existing `!featured` branch.

---

## 3. Decisions (settled 2026-11-17)

| # | Decision | Note |
| --- | --- | --- |
| D1 | The review hero runs **from the end of the last race until the 2027 pre-season test sessions begin**. | The test is an event like any other and gets its own dedicated hero; no third "winter" mode. |
| D2 | The title is **champion-led**, with a neutral fallback. | `"{Champion} · 2026 Drivers' Champion"`, degrading to `"2026 season complete"` when the standings are not final (§6.2). |
| D3 | **Minimal landing fetches.** | Only the two standings endpoints. No per-driver/constructor season stats, no per-round classifications, no podiums or title-margin history in v1. |

D3 justifies itself: `wins` is already on both standings rows, so distinct race
winners costs nothing, while `podiums` would cost one `fetchConstructorSeason` per
team and N `fetchDriverSeason` calls for the grid (§6.1).

---

## 4. The phase predicate

Add a pure helper beside the existing ones — **do not** change `findFeaturedEvent`'s
return type, it is consumed by `Home`, `SeasonView`, `Calendar` and `FeaturedEventBar`:

```
type SeasonPhase = 'live' | 'upcoming' | 'review'

seasonPhase(races, today) → SeasonPhase
```

Rules, in order:

1. today is inside a round's `eventWindow` → `'live'` (existing hero, unchanged).
2. today is before the calendar's first round → `'review'` (the season just finished;
   see §6.3 for the year it summarises).
3. today is after the calendar's last round → `'review'`.
4. otherwise → `'upcoming'` (existing hero).

Gate on **calendar edges only**, never on "gap to the next event". A generic
"nothing within 14 days" rule would swap the hero for a review during the August
shutdown, mid-season.

Consequences:

- `Home.tsx:25-37` renders `SeasonReview` instead of `FeaturedEventPanel` when the
  phase is `review`. `render` is already the only branch point it needs.
- Cases 2 and 3 are both `review`, so the hero survives the calendar rollover
  without a special case (§6.3).
- `'upcoming'` still means the event hero, so nothing changes for the 23 races.

The testing hero (§9) is a **fourth candidate that pre-empts rule 1/2** once the test
sessions are in the schedule: order becomes live → testing-window → review → upcoming.

### 4.1 Date discipline

`TODAY` / `NOW_MILLIS` are frozen at module load (`src/lib/schedule.ts:10-23`). A tab
left open across the last race will not flip to the review until reload — the same
known limitation as the featured round, documented at `README.md:557-560`. Not worth
fixing here; the review copy must simply not imply real-time precision.

`seasonPhase` takes `today` explicitly, like the rest of the module, so `?now=` works
for preview: **`?now=2026-12-05T00:00:00Z`** renders the whole off-season state in dev.
That is the QA story for this feature.

---

## 5. Content and layout

Same shell as the featured hero — `<section class="hero hero--review">`, `.hero__main`
left, `.hero__schedule`-equivalent right — so the page does not visibly resize when
the mode changes.

| Left column | Right column |
| --- | --- |
| Badge: `Season complete` (`pill--final`) | Heading: `Constructors` |
| `<h2 class="hero__title">` champion line (D2) | Top 3 constructors: position, colour bar, name, points, wins |
| Meta: `24 rounds · 6 winners` | (no per-constructor extras — D3) |
| Top 3 drivers: position, code chip, name, team, points, wins | |
| CTA row (see §7) | |
| Footer line: next event, e.g. `Next: pre-season testing · Bahrain · 24 Feb 2027` | |

Details that keep it consistent with the rest of the app:

- **Colour** — driver rows resolve `standing.Constructors[0]?.constructorId`, constructor
  rows `standing.Constructor.constructorId`, both through `teamColor()` and
  `readableInk()` (`src/api/teams.ts:49-98`). Identical to
  `DriverCompareDialog.tsx:67`. No new colour logic, no per-driver overrides.
- **Semantics** — the podium lists are `<ol>`; the section uses `aria-labelledby`
  like the existing hero.
- **CSS** — reuse `.hero`, `.hero::before`, `.hero__main`, `.hero__top`, `.pill`,
  `.pill--final`, `.button--ghost`. New: a `hero--review` modifier (grey/amber spine,
  already the visual idea behind `hero--final`) plus a podium row block, ~60–80 lines
  in `index.css` next to the featured-event block (`index.css:1156-1389`). No new
  tokens; use `--paper`, `--paper-raised`, `--line`, `--line-strong`, `--ink`,
  `--ink-muted`, `--amber`, `--red`.
- **Champion emphasis** — position `1` gets a slightly stronger row treatment (colour
  bar at full width vs a thin rule). No trophy glyph, no confetti.

---

## 6. Data

### 6.1 What is free, and what is not

Two requests, both already used by The Grid and Constructors:

| Call | Rows | Fields used |
| --- | --- | --- |
| `driverStandings(season)` | `DriverStanding[]` | `position`, `points`, `wins`, `Driver.{code, familyName, permanentNumber}`, `Constructors[0].constructorId` |
| `constructorStandings(season)` | `ConstructorStanding[]` | `position`, `points`, `wins`, `Constructor.{name, constructorId}` |

Types: `src/api/types.ts:78-93`; fetchers: `src/api/client.ts:22-73`. Points, position
and wins are **strings** — parse, don't coerce blindly.

Derived at zero cost:

- `24 rounds` — `races.length`.
- `6 winners` — count of driver rows with `Number(wins) > 0`.
- P1–P2 points gap — `Number(p1.points) - Number(p2.points)`.

Explicitly **not** used (D3): `podiums`, poles, fastest laps, retirements, avg race
position. Those live in `ConstructorStats` / `DriverStats` (`src/lib/constructorSeason.ts`,
`src/lib/driverSeason.ts`) behind one request per entity (10-minute memory caches in
`src/api/constructorSeason.ts` / `driverSeason.ts`). Out of scope for the landing page.

Also not used: per-round classifications. There is no Ergast-side per-round results
fetcher; results come from the Worker (`sessionResults` → `/api/results/{season}/{round}/{code}`)
keyed by alpha opaque round ids via `useSeasonRounds`. The review hero does not need
them — with one exception, the "final race" CTA (§7), which reuses the existing results
path rather than fetching anything itself.

### 6.2 Standings lag

`MRData.StandingsTable.StandingsLists[0].round` is "after round N"
(`DriverStandings.tsx:28-29` already reads it). If `N < races.length`, the standings
are behind the last race — the exact situation the results Worker exists for.

Behaviour:

- `N === races.length` → title may name the champion (D2), badge `Season complete`.
- `N < races.length` → neutral title `2026 season complete`, meta line
  `standings after round N`. No champion claim off stale data.

Nothing here may assert "champion decided" from a points gap: there is no clinch
helper in the repo, and computing one from points + rounds remaining is a separate
piece of work with its own edge cases (sprint points, countback). The review is
descriptive, not prognosticated.

### 6.3 Which season it summarises (the calendar-flip mitigation)

`/current/races` is unpinned. When jolpica resolves "current" to 2027 — which may
happen at the year boundary, before round 1 — `season`/`races` change wholesale and
`findFeaturedEvent` would lead with the **2027 Australian GP on 2 April**, i.e. a
three-month countdown to nothing, while standings and compare silently show an empty
2027 table.

Mitigation, at no extra endpoint cost: both standings fetchers already take a season
string, so when the phase is `review` **and** the calendar's first round is in the
future, summarise `String(Number(season) - 1)` and print that year in the hero.

- Season finished, calendar still 2026 → summarise 2026.
- Calendar flipped to 2027 → still summarise 2026 (previous year), until the testing
  hero / event hero takes over.
- Empty or partially published next-season calendar → same rule, still 2026.

The hero must therefore carry an explicit displayed year, never an implicit "this
season".

---

## 7. CTAs and the comparison hand-off

Ordered row:

| CTA | Action | Cost |
| --- | --- | --- |
| **Compare drivers** (primary) | `changeTab('drivers')` | none |
| **Compare teams** | `changeTab('constructors')` | none |
| **Final race** | `openRace(lastRound.round)` → Chequered Flag tab | none (existing state path) |

`SeasonView.openRace(round, session?)` (`SeasonView.tsx:62-66`) already sets
`requestedRound`/`requestedSession` and `tab='results'`; the review hero gets the same
`onOpenRace`-style prop the featured hero uses via `Home`.

**Why a tab switch is enough for v1:** `DriverCompareDialog.tsx:77` and
`ConstructorCompareDialog.tsx:72` both hardcode `initial={standings.slice(0, 2)}`, and
standings are position-sorted — so the dialog already opens on **champion vs
runner-up**, which is exactly the comparison the hero is advertising. One extra click,
no plumbing.

**Deferred (phase 2):** a one-click, hero-seeded dialog needs `initialIds?: readonly
string[]` on both wrappers **and** lifted open-state (or a second mount point in
`SeasonView`) — `compareOpen` currently lives inside `DriverStandings` /
`ConstructorStandings`, and the wrappers require `standings` as a required prop. There
is no router or deep-link support anywhere, so any hero→dialog link is a state change,
not a URL. Only worth it if we want hero-side selection (click a podium row → compare
against the champion).

---

## 8. The compact bar on the other five tabs

`FeaturedEventBar` (`FeaturedEvent.tsx:158-202`) renders on every non-home tab whenever
`featured` is truthy, and clicking it returns to The Pit Wall. In review mode it would
advertise a finished final round on all of them.

Change it to a compact **`2026 season review`** bar: same `pill`/`event-bar__*`
classes, same "click to return home" behaviour, text from the review subject. It stays
the only way back.

---

## 9. Hand-off to pre-season testing (Feb 2027)

Recorded here because it constrains the predicate, not because it is built now.

Verified against the live APIs on 2026-11-17:

- **OpenF1 covers testing** as a meeting with `session_type: "Practice"` and one
  session per day (`Day 1`…`Day 4`). 2026: meetings 1304 (11–13 Feb) and 1305
  (18–20 Feb), sessions 11465–11470, `meeting_name: "Pre-Season Testing"`. 2025: one
  Bahrain test, meeting 1253.
- `session_result` answers for those keys with a real classification (`position`,
  `number_of_laps`, `duration`, `gap_to_leader`), and `drivers`/`laps`/`position`
  behave as in a practice session.
- **2027 is already published**: meeting 1309, `FORMULA 1 ARAMCO PRE-SEASON TESTING 2027`,
  Sakhir, **24–27 Feb 2027**, sessions `92713091`–`92713094`. 2027 has 24 rounds with
  **Bahrain opening on 12 March** (Australia not until 2 April).
- **jolpica does not cover testing**: `/f1/alpha/core/rounds/?year=2026` is 24
  championship rounds with no test; 2027 rounds is empty; the legacy Ergast-shaped
  endpoints carry championship rounds only. OpenF1 is the only source.

Therefore:

- D1's boundary is a real, checkable moment: the first 2027 testing session
  (`2027-02-24T04:00:00Z`).
- The review hero should print the next known event in its footer now (static copy is
  enough), and the testing hero later replaces it in this same slot — ordered as a
  candidate ahead of `review`, not as a parallel feature.
- Testing sessions have ~8–9 hour windows (2027: 04:00–12:00 UTC), so they cannot
  reuse `SESSION_MINUTES` as if they were hour-long sessions. That belongs to the
  testing plan.
- The testing hero will need OpenF1 data outside the Worker's jolpica-alpha path; the
  review hero deliberately does not (two standings calls only), which keeps this
  feature disjoint from that work.

---

## 10. Scope

### In scope (v1)

- `seasonPhase` predicate + `SeasonReview` component + wiring in `Home` / `SeasonView`
  and the compact bar.
- Driver and constructor podiums from the two standings endpoints, livery colours.
- Free derived stats: rounds, distinct winners, P1–P2 gap.
- Three CTAs (§7), including the existing results path for the final race.
- `?now=` preview of the off-season state.
- CSS in the existing hero idiom; no new tokens.

### Explicitly out of scope

- Per-entity season stats (podiums, poles, fastest laps, averages) — D3.
- Any "champion clinched" computation or copy.
- Hero-seeded compare dialogs (`initialIds` + lifted modal state) — deferred, phase 2.
- Per-round recap, race-by-race timeline, season highlights carousel.
- URL/query deep links (the app has none; adding them is its own decision).
- The pre-season testing hero itself (separate plan).
- Fixing the module-load-frozen `TODAY`.

---

## 11. Implementation outline (when we start)

| Phase | Work | Files |
| --- | --- | --- |
| 1 | `seasonPhase` + `reviewSeason` helper, with tests | `src/lib/schedule.ts`, new `src/lib/seasonPhase.test.ts` |
| 2 | `SeasonReview` component (podiums, CTAs, footer line) | `src/components/SeasonReview.tsx` (new) |
| 3 | Mode selection + bar variant | `src/components/Home.tsx`, `SeasonView.tsx`, `FeaturedEvent.tsx` |
| 4 | Styles in the hero idiom | `src/index.css` |
| 5 | Verify with the season clock | `?now=2026-12-05T00:00:00Z`, plus a `?now=` just after the last race |

Tests worth having (pure module, no DOM):

- `seasonPhase` returns `review` after the last round's window and before the first
  round's window, `live` inside a window, `upcoming` between windows.
- The previous-year rule: 2027 calendar + today in Dec 2026 → summarise 2026.
- The standings-lag branch: `round < races.length` → neutral title, no champion.

Component tests are not planned; per project convention they come at the end of the
feature and only for behaviour that is hard to check by hand.

---

## 12. Risks and edge cases

| Risk | Handling |
| --- | --- |
| jolpica `/current` flips to the next season mid-winter | §6.3 — summarise `season - 1` while the calendar's first round is in the future |
| Standings lag the final race | §6.2 — neutral title, "after round N" |
| Next-season calendar partially published (few rounds) | Same rule; the review does not depend on the next calendar's completeness |
| One standings call fails | Both are independent `useFetch` calls; a failed side renders `Empty`, the hero still stands (same posture as `NewsPanel`) |
| A cancelled final round (`is_cancelled`) | Use the last non-cancelled round's window as the closing edge |
| Page left open across the last race | Documented limitation; review appears on reload |
| Long countdown from a flipped calendar | Avoided: the winter shows the review, not "Australia in 102 days" |
| Mid-season August shutdown | Avoided: the predicate keys off calendar edges, not a day gap |

---

## 13. Open questions

1. Footer line wording for the next event before the testing plan exists: static
   `Pre-season testing · Bahrain · 24 Feb` copy, or omit until OpenF1 drives it?
2. Does the review hero belong on *The Pit Wall* only (current plan), or also replace
   the compact bar's click target semantics on the calendar tab?
3. Should the review year be a visible label on the section (recommended, for a
   screenshot to be unambiguous) or only in the title?

---

## Appendix — evidence gathered 2026-11-17

- OpenF1 `sessions?year=2027` → meeting 1309, sessions 92713091–92713094, `Day 1`–`Day 4`,
  2027-02-24…2027-02-27, Sakhir; Bahrain GP meeting 1310 on 2027-03-12.
- OpenF1 `meetings?year=2026` → meetings 1304/1305 `Pre-Season Testing`, Sakhir,
  11–13 and 18–20 Feb.
- OpenF1 `session_result?session_key=11465` → 20-row classification with laps and gaps.
- jolpica `/f1/alpha/core/rounds/?year=2026` → 24 rounds, R1 Australia, no test.
- jolpica `/f1/alpha/core/rounds/?year=2027` → `count: 0`.
- jolpica alpha root → `core/rounds`, `core/sessions`, `core/laps`,
  `core/pit-stops`, `schedules`; no testing concept.

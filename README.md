# Box this Lap!

Live standings and updates from the pit wall.

A small, clean React app for browsing Formula 1 results and championship standings,
powered by the free [jolpica-f1](https://github.com/jolpica/jolpica-f1) API.

## Features

- **The Pit Wall** — the next or current race at full size, with the circuit's **Info** popup,
  plus the five newest headlines from the paddock
- **Paddock and Coffee** — the paddock press, merged from five outlets and sorted newest first
- **The Schedule** — every round of the season with circuit, location and date. Completed rounds
  open their results; rounds still to come open a details panel instead, since there is
  nothing to show yet. Every round also offers an **Info** popup with the circuit's track
  layout and racing history
- **The Grid** — driver championship table, with each position in a team-coloured chip
- **Constructors** — team championship table
- **Chequered Flag** — every session of a weekend: practice 1–3, sprint qualifying,
  qualifying, the sprint and the race. Qualifying can also be read as a **Starting
  Grid**, laid out the way the cars line up. Finished races and sprints offer a
  **Replay**, and finished qualifying sessions a side-by-side **1v1 Battle**
- The featured event stays visible in every section as a compact bar that links back to
  The Pit Wall
- Dates and times are shown in **your own timezone**, not the circuit's
- **Light and dark themes**, switched from the header and remembered, following your system
  preference until you choose
- Loading, empty and error states with retry, and full keyboard/ARIA support

The app follows the **season in progress**. There is no season picker: the current season is
resolved from the API and shown in The Schedule panel, which is titled with it (for example
`2026 Calendar`).

The section names above are the tab labels. Each tab keeps a stable id (`home`, `news`,
`calendar`, `drivers`, `constructors`, `results`) for its ARIA wiring.

## Navigation

| Section | Content |
| --- | --- |
| **The Pit Wall** | Full-size featured-event panel + the five newest headlines |
| **Paddock and Coffee** | Every headline the feeds are carrying, newest first |
| **The Schedule** | Round list with the featured race highlighted; future rounds open a details panel, every round opens a circuit info popup |
| **The Grid** | Driver championship table |
| **Constructors** | Constructor championship table |
| **Chequered Flag** | Every session of a selected round |

Every section except The Pit Wall shows `FeaturedEventBar`, a compact summary of the featured
event. Clicking it returns to The Pit Wall. On narrow screens the bar hides the circuit and
date details and drops the countdown to a second line, so the race name keeps its full width.

## Look and feel

The app is styled after the [Golden Lap](https://www.funselektor.com/goldenlap) interface:
flat, warm and retro. Cream "paper" panels sit on a soft pastel haze, text is near-black
ink, and a single warm red carries every call to action. The header pairs a headset-wearing
pit-wall operator mark with the name **Box this Lap!** and its tagline, "Live standings and
updates from the pit wall."

- **Type** — one variable family, [Archivo](https://fonts.google.com/specimen/Archivo), in
  roman and italic. Three voices carry the interface; the hierarchy and the rules that keep it
  coherent are set out under [Typography](#typography).
- **Colour** — the palette lives in custom properties at the top of `src/index.css`. Cream
  `#f4efe2` paper, `#1b1b1b` ink, and Golden Lap's `#e4161c` red as the accent. Amber marks
  an event still to come; magenta marks a fastest lap, and the `FL` chip carries the lap time
  in a bubble that opens on hover, on keyboard focus or on tap.
- **Position chips** — every finishing position is a flat chip filled with that team's
  colour, the way Golden Lap marks a car on the grid. Chip text flips between ink and paper
  based on the livery's luminance (`readableInk` in `src/api/teams.ts`), so it stays legible
  on both a near-white Haas and a near-black livery.
- **Flat by default** — content surfaces carry no gradients or glows (the only gradient is the
  pastel backdrop). Depth comes from a hairline border and one soft shadow. Every colour pair
  used for text was checked against WCAG AA.

### Typography

One family, [Archivo](https://fonts.google.com/specimen/Archivo), self-hosted from
`public/fonts` in roman and italic. Its weight and width axes do the work, and three voices
cover the interface:

| Voice | Setting | Used for |
| --- | --- | --- |
| **Display** | Italic, weight 900, 92% width, uppercase, 0.005em tracking | The subject of a block: brand, hero race name, collapsed event bar, panel headings, dialog titles |
| **Workhorse** | Upright, condensed 78%, weight 700–800, uppercase, 0.07em tracking | Second-level headings, column heads, tabs, buttons, chips, kickers |
| **Reading** | Upright, normal width, weight 400–700 | Body copy, excerpts, row names, headlines, numbers |

The display face is the poster voice: heavy and leaning, set tight so a title reads as one
block of motion rather than spaced-out signage. These rules keep it coherent:

- **One display line per block.** The eye should land on one leaning title; a second one in
  the same block cancels the first out.
- **Never below ~14px.** All-caps italic is hard to read small, so the collapsed event bar at
  `0.9rem` on phones is the floor.
- **Subject only.** The name of the page, panel, dialog or event takes the display face. A
  row, an article, a label or a control does not.
- **No italic for data or controls.** Numbers, times, points, column headers, tabs and buttons
  stay upright: slanting tabular figures breaks their alignment, and slanted controls read as
  emphasis rather than affordance.
- **Let the second tier recede.** Sub-headings (`Weekend schedule`, `Layout history`, `Did not
  qualify`) stay upright and condensed, as do article headlines, which are 700 upright rather
  than a second display line.
- **True italic, not a skew.** The italic cut is drawn, not synthesised — no `transform:
  skew` and no oblique fallback.
- **Balanced wrapping.** Display titles use `text-wrap: balance`, so a two-line mobile hero
  breaks evenly (`UNITED STATES / GRAND PRIX`) instead of orphaning its last word.

Self-hosting keeps a third party off the critical path, and both cuts are preloaded from
`index.html` because the stylesheet references them immediately.

### Light and dark

The theme comes in **light and dark**, switched from the button in the header's top-right. The
icon shows the theme a press will bring — a moon in light mode, a sun in dark mode — so it
reads as the action rather than the current state, and the choice is remembered on the device.

A first visit follows the **system** preference; once a visitor chooses, that choice sticks.
The whole palette lives on custom properties, so dark mode is a second token block in
`src/index.css` that turns the paper to a warm near-black and the ink to a warm off-white,
leaving the brand colours and the team liveries untouched. Two things sit outside the tokens
and are handled on their own: the pastel page haze gets a dark twin, and the vendored track
layouts — black strokes on transparent — are inverted, so a circuit map reads as a light
outline at night.

The theme is one attribute on `<html>` (`data-theme`). It is applied before first paint by a
small inline script in `index.html`, so the page never flashes the wrong theme, and React picks
the attribute back up in `src/hooks/useTheme.ts`. The `theme-color` meta tag follows it too, so
the browser chrome matches.

## Circuit info

Every row of The Schedule carries an **Info** button (alongside Details/Results) that opens a
popup about the circuit — available whether the round is past or still to come. It shows the
circuit's vendored track layout (see "Circuit images"), its coordinates and Wikipedia link, its
**racing history** (how many Grands Prix it has held, the first and most recent, the
drivers and teams with the most wins, and the five most recent editions with each winner's
fastest lap), and its **layout history** when the track has changed shape over the seasons.

The only extra request is the circuit's past winners from
`/ergast/f1/circuits/{circuitId}/results/1/?limit=100`, summarised in `src/lib/circuitHistory.ts`
and rendered by `src/components/CircuitInfo.tsx` inside the shared `Modal`.

## Session results

The **Chequered Flag** section shows every session the API can serve for a round, selected
with a segmented control under the round picker. Sessions are listed in the order the weekend
runs them.

| Session | Code | Table columns |
| --- | --- | --- |
| **Practice 1/2/3** | `FP1` `FP2` `FP3` | Pos, driver, team, best lap, gap to the pace-setter, laps |
| **Sprint Qualifying** | `SQ` | Pos, driver, team, and the SQ1/SQ2/SQ3 segment times |
| **Sprint Race** | `SR` | Same shape as the race table, with reduced points |
| **Qualifying** | `Q` | Pos, driver, team, and the Q1/Q2/Q3 segment times |
| **Race** | `R` | Pos, driver, team, grid, laps, time/status, points, fastest-lap badge |

Notes:

- **Which sessions a round has comes from the calendar**, not from a guess. Every session of
  the weekend is listed from the round's schedule, so a sprint weekend correctly offers
  practice 1, sprint qualifying, the sprint, qualifying and the race, while a normal weekend
  offers practice 1–3, qualifying and the race. The alpha results index is used only to add a
  label if it lists a session the calendar does not.
- **The opening session is the most recent one that has already started.** Visiting a round
  mid-weekend lands on whatever just ran — during a Friday practice the app opens on practice
  1 rather than jumping ahead to the race.
- Sessions with no data yet show an explicit "not available yet" notice, which is the normal
  case for rounds still to come.
- **jolpica is canonical and OpenF1 is the provisional fallback.** A small Cloudflare Worker
  (see "The results Worker" below) fetches each session, keeps the durable result in Workers
  KV and serves the table. When jolpica has not published a complete classification, the
  Worker asks OpenF1 for `session_result` — for `FP1`–`FP3`, `SQ`, `SR`, `Q` and `R`. The
  provisional table is labelled with its source; it is never presented as final, and jolpica
  replaces it as soon as a complete classification is available. For qualifying, OpenF1's
  per-segment `duration` array is mapped to the same Q1/Q2/Q3 components the starting grid
  uses. For races and sprints, the grid column comes from OpenF1's starting-grid feed for the
  corresponding qualifying session (`Q` for `R`, `SQ` for `SR`), falling back to the
  qualifying classification order when that feed is unavailable.
- **The Worker does the polling.** While a result is pending or provisional it is refreshed
  about once a minute (`pollAfterMs` in the response); polling stops as soon as the table is
  final, and a hidden tab is checked immediately when it comes back into view. A two-minute
  cron warms sessions around their windows, and final classifications are rechecked at
  roughly +1h, +6h, +24h and +72h so a post-race amendment (a penalty or disqualification)
  lands without a page reload. The development clock override
  (`?now=2026-10-25T22:05:00Z`) exercises the time-based tabs without waiting for a race.

### The results Worker

Session results are served by a single Cloudflare Worker, not fetched by the browser:

```text
browser ── /api/results/{season}/{round}/{code} ──▶ Vercel rewrite ──▶ Worker ──▶ KV
                                                                        ├──▶ jolpica (canonical)
                                                                        └──▶ OpenF1 (provisional)
```

- **One endpoint per session.** `GET /api/results/{season}/{round}/{code}` returns the same
  table shape for every state (`pending`, `provisional`, `final`), plus the source, the last
  check time and a `pollAfterMs` hint. `GET /api/status` exposes the cron heartbeat and the
  last state seen for each session; `GET /health` is a cheap liveness probe.
- **KV is the cache, not a database.** A durable `CachedResult` stores the classification and
  the per-source summary. A monotonic `revision` and a state-rank guard prevent a late
  provisional refresh from overwriting a `final` result. Writes happen only on a real state
  change, so a two-minute cron does not hammer the KV write limit.
- **The cron warms what is due.** `*/2 * * * *` refreshes at most four finished sessions from
  the last week, prioritising sessions that have gone longest without a check. It only emits
  a `meta:status` heartbeat every ten minutes.
- **OpenF1 is server-side.** The free tier's 401/403 live lock and 429 rate limits are
  handled in the Worker (with a `retryAt` backoff), so the browser never calls OpenF1 for a
  result. The fallback is tried only while jolpica is incomplete.
- **Deployment is separate from the frontend.** `npm run worker:deploy` publishes the Worker to
  `https://boxthislap-results.fabrizio-dec90.workers.dev`, and `vercel.json` rewrites
  `/api/results/*`, `/api/status` and `/health` there. `npm run dev` proxies `/api` to
  `wrangler dev` on port 8787. To call the Worker directly instead, build the frontend with
  `VITE_RESULTS_BASE=https://boxthislap-results.fabrizio-dec90.workers.dev/api/results`; the
  Worker sends `Access-Control-Allow-Origin: *` for that case. The Worker name is
  `boxthislap-results`, and the KV binding is `RESULTS`.

The shared wire types and pure helpers live in `src/shared/` and are imported by both the
browser and the Worker. The Worker itself lives under `worker/src/` and is bundled by
Wrangler; Vite ignores it.

### The Starting Grid

Qualifying and sprint qualifying can be read two ways. A **Table | Grid** toggle sits at the
far end of the session bar — only for `Q` and `SQ`, because only they have a grid to show —
and the table stays the default, so nothing changes for anyone who does not go looking.

The grid is drawn from the payload already on screen: switching views makes **no new
request**. Each plate carries the grid slot, the **car number** in the livery colour, the
driver over the team, one dot per segment (filled when a time was set in it, hollow when the
car was already out of that part of qualifying) and the gap to pole. Every car is measured
against the pole, so the pole plate has no gap to show — it prints the **pole time** itself,
in ink rather than as a muted delta. The pole-sitter also gets the heavier plate and a red
slot label.

Cars that set no time are not on the grid: they are pulled out of the classification and
listed below it as **Did not qualify**, with no slot and an `NC` mark. Slots are numbered
from 1 in grid order rather than taken from the API, so an excluded car does not leave a hole
behind it — Singapore's sprint qualifying has two cars retire in SQ3, and the 20 that remain
are grid slots 1–20.

Two details worth knowing:

- **The two columns are one ordered list.** The classification stays in reading order and CSS
  drops every second plate half a row, which is what makes the columns interlock. A screen
  reader, and the single-column layout a phone falls back to, both read the grid straight
  down from pole.
- **The car number is on the plate; the slot is what orders it.** The badge is decorative to
  assistive tech, the `P1` label is not, so a plate reads as "P1, Max Verstappen, Red Bull" —
  the number alone would be ambiguous out of context.

### Race replay

A finished **Race** or **Sprint** can be replayed. The **Replay** button sits at the far end of
the session bar, next to the Table | Grid toggle, and opens a wide version of the same cream
dialog used for circuit info. It shows the circuit outline with every car in its team colour,
a live standings tower on the right, and a transport bar underneath. The current **lap
counter** sits beside the Standings heading. A weather strip attached to the top of the track
panel shows the **track temperature**, **air temperature**, **wind speed** and **rain status**
at the playhead, each with a small icon. Tower rows keep the position, driver code,
**gap to the car ahead**, **last completed lap time**, **current tyre compound** and the
**number of completed pit stops**; the full name and constructor stay available in the
tooltip and screen-reader label.

When race control neutralises the race, a **Safety Car**, **Virtual Safety Car**, **Red Flag**
or **Yellow Flag** banner appears over the circuit. The safety-car banner switches to **in
this lap** or **ending** once the withdrawal has been announced. A red flag stays up from the
suspension until the session restarts. Yellow flags are sector-level: the banner lists the
marshalling sectors that are still yellow, and is suppressed while a safety car, VSC or red
flag already neutralises the whole track. Everything clears when race control goes green
again, and the chequered flag closes any open period.

Clicking a row adds that driver to a multi-driver filter and draws only those cars on the
circuit; clicking again removes them. The tower keeps the full field visible, selected rows
are marked, the map caption reports the visible count, and a **Reset** button in the Standings
header clears the filter.

The dialog has two tabs. **Race** is the circuit and standings tower. **Pace** draws one
line per driver across the race, with **lap number** along the bottom and **completed lap time**
(shown as `min:sec`) up the side, so stints, pit stops and the shape of the race are visible at
a glance. The lines
are drawn **live**: a lap only appears once the replay playhead has passed its end, and
scrubbing backwards retracts the graph. They use a smooth monotone curve through the lap
points rather than hard corners. The y-axis fits the full clean-lap range of the drivers
currently shown, including laps not yet revealed, so it stays stable during playback and never
clips a fast lap. The driver chips above the graph filter it exactly like the tower filters the
map, the selection is shared between tabs, and a **Reset** button clears it.
With a small selection, each lap gets a dot; hover a dot to see the driver, lap number and lap
time. Laps more than five percent slower than a driver's median — pit in/out laps, safety-car laps
and other interruptions — are left out so they do not squash the racing pace into the bottom of
the axis. The replay playhead is drawn as a dashed guide over the graph, and the graph follows
the same transport underneath.

The button is enabled from **thirty minutes after the chequered flag** — the point at which
OpenF1's historical data becomes free — and disabled with an explanation before that, or
when the selected session is practice/qualifying. The transport shows the leader's lap
(**Lap 12 / 62**) and the replay opens at **lights out**, not in the garage or on the
formation lap. Keyboard: **space** plays/pauses and **←/→** scrubs ten seconds. The replay
starts paused.

How the data gets there:

- **Pre-baked assets first.** `public/replays/index.json` maps the season, session code and
  date to an OpenF1 key, so the app does not have to ask OpenF1 which session a race is.
  `public/replays/{session_key}.json` then carries the timeline (downsampled to 2 Hz,
  coordinates quantised to metres), the lap starts and per-driver lap times, the tyre
  stints, the gap-to-car-ahead timeline, the weather timeline, the safety-car periods and
  yellow/red flag periods from race control, the circuit outline and the position feed in one
  file. Nothing third-party is called for a baked race.
- **OpenF1 fallback.** If a race has not been baked, the browser calls OpenF1 directly
  (CORS is open), one location request per car, throttled to the free tier's 30 requests a
  minute. It also loads the session's weather samples and race-control feed. The dialog
  shows progress and caches the result in IndexedDB, so the next visit is instant.
- **No live streaming.** OpenF1's free tier only serves a session after the flag; during the
  live window the button states when the replay will be available.

Bake or refresh the assets with:

```bash
npm run replays -- --season 2026              # every finished race/sprint of the season
npm run replays -- --season 2026 --latest 3   # the three most recent only
npm run replays -- --session 11388 --force    # one session, overwrite
```

The script spaces requests two seconds apart, caches raw responses under `.cache/`
(git-ignored), and writes `public/replays/index.json` and `public/circuits.json` alongside
the replay files. Most races are **0.5–0.9 MB gzipped** at 2 Hz; the 2026 season is about
**13.4 MB gzipped** (39 MB on disk). `--hz 1` roughly halves that at the cost of smoother
cornering. Baked files are committed, so the feature works with no runtime OpenF1 dependency.

Two 2026 circuits — Madring and Kuala Lumpur — have no published geometry in Multiviewer.
For those the bake traces the line one car took on its first lap and the map says **outline
traced from cars**; the replay still plays, with the tower and transport unchanged.

OpenF1 data is licensed **CC BY-NC-SA 4.0** (personal, non-commercial use). The footer credits
it next to jolpica.

### Qualifying 1v1 battle

A finished **Qualifying** or **Sprint Qualifying** session offers a **1v1 Battle** instead of
the Replay button. Pick two drivers and one timed lap each — the dialog opens with the two
quickest drivers already selected, each on their fastest lap — and start the battle.

The battle view is a **telemetry ghost**, not a video:

- a **scoreboard** with both drivers, their lap times, the live gap and the exact lap delta;
- the **circuit map** with both cars in team colour, plus a progress ribbon per driver. OpenF1
  has no lateral position, so the cars share the racing line and the ribbons carry the
  separation in the corners;
- two **cockpit panels** with speed, gear, rpm, throttle, brake and DRS. Only channels OpenF1
  publishes are shown, and a missing channel reads `—` instead of inventing a value;
- an exact **sector table** (`S1` / `S2` / `S3` / lap) with each split, the faster of the two
  times highlighted, and the delta relative to driver A;
- one shared transport: play, scrub, **0.5× / 1× / 2× / 4×**, plus **Change drivers** at the end
  of the row. Space plays/pauses, **←/→** scrubs one second, and reduced-motion visitors start
  paused.

The track and its sector table share the left column, and the two cockpits stack in the right, so
the circuit and the telemetry can be followed without looking up and down. Below **720px** the
stage collapses to one column: track, cockpits, sectors.

Both laps are normalised to their own start line, so laps set minutes apart can share one
playhead. The **live gap** is an estimate: it integrates each car's speed into a distance curve
and asks *at the same point on track, who got there first?* It reads `0.000` at the line and
converges on the exact lap-time difference at the flag. The sector table is the exact reference,
because sector and lap times come straight from OpenF1, while `date_start` is approximate.

Data is fetched **on demand** from OpenF1: the session, field, lap list and circuit once, then a
lap-sized `car_data` and `location` window per driver (about **180 KB** for the four feeds; a
whole qualifying session would be several MB per driver). Requests are throttled to the free
tier and the finished battle is cached whole in its own IndexedDB database
(`box-this-lap-battles`), so a repeat battle is instant. There are no pre-baked battle assets.

The button follows the same availability rule as the replay: the session has to be finished plus
thirty minutes, when OpenF1's free historical window opens.

### Where the data comes from

jolpica exposes two layers, and the app uses both:

- the **Ergast-compatible** endpoints (`/ergast/f1/...`) for the calendar and the
  driver/constructor standings. These are the stable, backwards-compatible routes.
- jolpica's **own API** (`/f1/alpha/...`) for session results.

The split is not a preference: the Ergast-compatible routes have no practice or sprint
qualifying endpoints at all, so the alpha layer is the only place that data exists. Race,
qualifying and sprint could be served by either; they go through the alpha layer too so that
every session is rendered from one response shape.

> **Heads up:** the alpha API is explicitly unfinished and its responses have been observed
> changing between requests (sometimes wrapped in `{ metadata, data }`, sometimes not).
> `src/api/alpha.ts` normalises the envelope, but the shape may still change without notice.

### Measuring results readiness

Neither API exposes when a result was published. jolpica's `metadata.timestamp`
is when the response was generated, a session's `timestamp` is its scheduled
start, and OpenF1's `session_result` has no timestamp at all. The delay between
the chequered flag and usable results therefore has to be sampled, not
reconstructed.

`scripts/results-readiness.mjs` polls both sources around a session and records
the first non-empty and first complete payload in `.readiness/results.jsonl`
(git-ignored):

- **jolpica** — `/f1/alpha/results/{roundId}/{code}/`, the same endpoint the
  results view uses.
- **OpenF1** — `/v1/session_result?session_key=…`, matched to the jolpica
  session by session name and scheduled start from `/v1/sessions?year=…`.
  OpenF1 returns 404 until results exist; the probe treats that as an empty
  sample.

```sh
# Watch the next round: wait for each session, then poll both sources
npm run readiness -- --round 18 --loop

# Watch only OpenF1 for one session
npm run readiness -- --round 18 --session R --source openf1

# Summarise what has been collected so far
npm run readiness:report
```

`--loop` starts five minutes before each session's estimated end and backs off
from 30 seconds to five minutes. A payload counts as complete when it contains
at least the round's driver count (falling back to 20) and at least one
positioned entry; retirements may legitimately have no position. `--once` is
suitable for an external scheduler: run it at least once before the session
ends, otherwise the first sample is already published and the report can only
show an upper bound. `--source` selects `both` (the default), `jolpica`, or
`openf1`.

The report prints one row per source and, when both sources have a first
non-empty sample for the same session, a direct comparison of how much earlier
or later OpenF1 was.

OpenF1's `session_result` is not its live-timing feed: the public OpenF1 repo
scrapes it from the official Formula 1 results page, and OpenF1 documents it as
becoming available "a few minutes after the official results are published on
the official Formula 1 website." That makes it a useful candidate for a
provisional fallback, but it also means the probe is measuring F1's publication
delay plus OpenF1's scrape cadence, not a real-time feed. The probe records
first-seen times, not the actual publication time, so a run that starts late can
only produce an upper bound.

OpenF1's historical data is free under CC BY-NC-SA 4.0, and its real-time feed
requires a paid subscription. It is therefore a candidate for a provisional,
non-commercial results fallback, not an automatic replacement for every jolpica
endpoint.

## Circuit images

The API does not serve circuit artwork, so the track layouts are **vendored as static SVGs**
in `public/circuits/`. They come from the [f1-circuits-svg](https://github.com/MisterSix2295/f1-circuits-svg)
project (a fork of julesr0y/f1-circuits-svg by Jules Roy), which is licensed **MIT** — see
`public/circuits/LICENSE.txt`. Every historical layout is included (e.g. `monza-1` … `monza-6`),
so a circuit's evolution over the seasons is available too.

`src/lib/circuits.ts` bridges the two naming worlds: its keys are the Ergast/jolpica
`circuitId`s the app already uses, while the files are named by the source project's own
layout ids (Ergast `spa` → `spa-francorchamps-4.svg`). `circuitImage(circuitId)` returns the
URL of a circuit's current layout, or `undefined` when it is not vendored — notably the 2026
**Madring** (Madrid) circuit, which postdates the source data.

The vendored set is not auto-updated. To refresh it, re-download the source's `black/` folder
into `public/circuits/` and regenerate `src/lib/circuits.ts`.

## Dates and times

The API sends everything in UTC. The app converts it to the **visitor's timezone**, using the
browser's own zone — there is no setting to choose, and nothing in the UI names the zone, so
the clocks are simply "the time where you are".

Two kinds of date are handled differently, in `src/lib/format.ts`:

- an **instant** — a date *with* a time — is shifted into local time;
- a **calendar day** — a date on its own, with no time to anchor it — is printed as written.
  Shifting one of those would move a race to the wrong day for anyone west of UTC, so a bare
  date is never converted.

This matters more than it sounds. The Singapore Grand Prix starts at `12:00Z` on 11 Oct, which
is Sunday morning in Europe, Sunday afternoon in Tokyo and **01:00 on Monday** in Auckland —
so the calendar and the results header show 12 Oct for a visitor there. Because the day can
move, the featured-event logic uses local days too, so "today" always agrees with what is on
screen.

## The featured event

The **Pit Wall** shows a panel for the event that matters right now. Its logic lives in
`src/lib/schedule.ts` and works on **date-only** string comparisons in the visitor's timezone:

1. Each race gets a **weekend window**: from its earliest session (`FirstPractice`,
   `SprintQualifying`, …) through to race day.
2. If today falls inside a window, that race is featured. It is labelled **Race day**
   when today is the race date, otherwise **Race weekend**.
3. Otherwise the next race whose window has not started yet is featured, labelled
   **Next up** with a countdown.
4. Once the season is finished, the final round is shown as the **Season finale** so the
   layout stays consistent.

The featured race is also highlighted in the calendar table.

Each calendar row ends with one action. A round already completed opens its **Results**; a
round still to come has no results to open, so it opens a **Details** dialog instead. That
dialog is the same `FeaturedEventPanel` used on The Pit Wall, filled in for the selected round
— its window, its race time and its full weekend schedule — rendered inside a native
`<dialog>`, so focus trapping, `Esc` and the backdrop come from the browser. The panel drops
its status badge for every round but the featured one: only that round may claim **Next up**,
the rest show their countdown alone.

Worked example, 2026 season — Singapore runs 9–11 Oct and the USA 23–25 Oct, both UTC:

| Today (local) | Featured |
| --- | --- |
| 10 Oct 2026 | Singapore Grand Prix (`live`) |
| 11 Oct 2026 | Singapore Grand Prix (`raceDay`) |
| 17 Oct 2026 | United States Grand Prix (`upcoming`, in 6 days) |
| 7 Dec 2026 | Abu Dhabi Grand Prix (`final`) |

The date-only window decides **which** round is featured; the clock decides what the panel
says about the moment. `weekendProgress` walks the same weekend schedule and compares each
session's start against a running `now` (`useNow`, refreshed every 30 seconds and whenever the
tab regains focus):

- While a session is on track, the badge becomes **Live · Qualifying** (or Practice, Sprint,
  Race) in red, and that row in the weekend schedule carries a pulsing red dot.
- Every finished session carries a **Finished** chip at the end of its row in the weekend
  schedule (dates and chips line up as columns), which opens that round on **Chequered Flag**
  with the session already selected. The chip labels the state rather than promising a
  classification; the session view explains when results are still pending. After the race
  itself the badge reads **Race complete**.

Session lengths are estimates (`SESSION_MINUTES` in `src/lib/schedule.ts`), deliberately
generous so a red flag or a safety car does not make a live session look finished early.

`TODAY` — the round to feature — is resolved once at module load in `src/lib/schedule.ts`.
The live-session marker and the finished-session chip use `useNow`, so they keep up for
the length of a browsing session; a page opened across midnight would need a reload to re-pick
the featured round.

## News

**Paddock and Coffee** reads the trade press directly, from the publishers' own RSS feeds:

| Outlet | Feed |
| --- | --- |
| **Autosport** | `https://www.autosport.com/rss/f1/news/` |
| **Motorsport.com** | `https://www.motorsport.com/rss/f1/news/` |
| **RaceFans** | `https://www.racefans.net/feed/` |
| **BBC Sport** | `https://feeds.bbci.co.uk/sport/formula1/rss.xml` |
| **The Race** | `https://www.the-race.com/rss/` |

Every row is the outlet, how long ago the story went up, the headline, and the standfirst the
publisher supplies. No article text is copied, and each headline links out to the publisher in
a new tab. The official site is not in the list: formula1.com has no RSS feed.

Decisions worth knowing about:

- **No RSS-to-JSON service.** `src/api/news.ts` fetches, merges, sorts and parses the feeds in
  the browser, using the native `DOMParser` — the files are already XML, and a service such as
  rss2json would put a third party in the path of every page load (its free tier also refuses
  to limit how many items it returns without an API key).
- **The requests are proxied, because RSS has no CORS.** No feed sends an
  `Access-Control-Allow-Origin` header, so a browser cannot read one directly. Each feed is
  requested from `/news/<id>` instead, and both `vite.config.ts` (`dev` and `preview`) and
  `vercel.json` (production) rewrite those paths onto the real feed. The two files have to be
  kept in step; **on a host other than Vercel the same rewrites must be reproduced**, or the
  section shows its error state.
- **The merge.** Newest first. Duplicates are dropped by headline, and also by standfirst,
  because Autosport and Motorsport.com are the same newsroom and run one story under two
  different headlines. The home screen shows the newest five; the section shows up to 60.
- **Freshness, and what it costs.** The merged list is cached in memory for ten minutes, so
  moving between tabs re-reads nothing, and `vercel.json` asks the Vercel CDN to cache each
  proxied feed for the same ten minutes. Reading all five costs about 80 kB gzipped in
  parallel, most of it The Race's feed, which carries full article bodies the app ignores.
- **One feed failing is not a failure.** If some sources are unreachable the rest still
  render; only losing all of them shows the retry state.
- **No images.** The feeds disagree on where a picture goes — `enclosure`, `media:thumbnail`,
  `media:content`, or nowhere — and a text-only list keeps the panel flat and quick.
- **The list is the scroll box, not the page.** Both the home panel and the section give the
  headlines the room the window leaves them (the `max-height` figures in `src/index.css` are
  the surrounding furniture — brand, tabs, featured event, panel head, footer — measured on
  screen), so the page itself stays still: the head holds its place and only the list moves,
  and a short window falls back to a floor of 12–14rem rather than a sliver. On a phone there
  is no room to box the home list in beside a full-size featured event, so it flows with the
  page instead and the head sticks to the top as the page scrolls under it. The section still
  fits a phone screen, so its list keeps the box.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### Other scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run oxlint |
| `npm run test` | Run the Worker/shared Vitest suite |
| `npm run worker:dev` | Run the results Worker locally on port 8787 |
| `npm run worker:deploy` | Deploy the results Worker |
| `npm run worker:tail` | Stream the deployed Worker's logs |
| `npm run worker:types` | Regenerate `worker-configuration.d.ts` after a binding change |
| `npm run worker:typecheck` | Type-check the Worker bundle |
| `npm run readiness` | Sample jolpica and OpenF1 result readiness (see above) |
| `npm run readiness:report` | Summarise the readiness samples |
| `npm run replays` | Bake static replay assets from OpenF1 (see "Race replay") |

## How the API is called

The jolpica-f1 API asks clients to send a custom `User-Agent`, but browsers forbid
JavaScript from setting that header. To satisfy the API without adding a backend,
`vite.config.ts` proxies two prefixes to `https://api.jolpi.ca` and attaches the header
server-side. The news feeds go through the same proxy for a different reason — RSS is served
without CORS headers — and are listed with the rest:

| Prefix | Upstream |
| --- | --- |
| `/api` | the results Worker (`wrangler dev` on port 8787; in production, a Vercel rewrite) |
| `/ergast` | the Ergast-compatible endpoints |
| `/f1` | jolpica's own alpha endpoints |
| `/news/<id>` | one feed per outlet, one path each |

The same proxies are configured for `vite preview`, so both `dev` and `preview` work out of
the box. Production is a static build on Vercel, which has no dev server: `vercel.json`
rewrites the five `/news/<id>` paths to the feeds and `/api/results/*`, `/api/status` and
`/health` to the results Worker. The rest of the app talks to jolpica directly, because that
API does send CORS headers (set `VITE_API_BASE` and `VITE_ALPHA_BASE` to the absolute URLs at
build time).

Endpoints used:

| View | Endpoint |
| --- | --- |
| The Schedule + current season | `/ergast/f1/current/races/?limit=100` |
| The Grid | `/ergast/f1/{season}/driverstandings/?limit=100` |
| Constructors | `/ergast/f1/{season}/constructorstandings/?limit=100` |
| Circuit info (history) | `/ergast/f1/circuits/{circuitId}/results/1/?limit=100` |
| Round ids for the season | `/f1/alpha/core/rounds/?year={season}` |
| Sessions a round has | `/f1/alpha/results/{roundId}/` |
| One session's results | `/api/results/{season}/{round}/{code}` (Worker) |
| Worker health / cron status | `/health`, `/api/status` |
| Paddock and Coffee | `/news/{outlet}`, proxied to that outlet's RSS feed |

The alpha results endpoints are keyed by an opaque round id (`round_JqmngOvt`), not by season
and round number, so `/f1/alpha/core/rounds/?year={season}` is fetched once to map the
calendar's round numbers onto those ids.

To point the app at the API directly instead, set `VITE_API_BASE` and `VITE_ALPHA_BASE`:

```bash
VITE_API_BASE=https://api.jolpi.ca/ergast/f1 \
VITE_ALPHA_BASE=https://api.jolpi.ca/f1/alpha \
npm run dev
```

## Project structure

```
src/
├── api/
│   ├── alpha.ts     # jolpica alpha client + the session codes we render
│   ├── client.ts    # Ergast-compatible client (calendar, standings)
│   ├── news.ts      # the trade press: feeds, parsing, the merged list
│   ├── openf1.ts    # OpenF1 client, session-key resolution, rate limiting
│   ├── resultsService.ts # browser client for the results Worker
│   ├── teams.ts     # team colours + readable chip ink
│   └── types.ts     # response types for both API layers
├── components/
│   ├── BattleCockpit.tsx        # 1v1 telemetry panel: speed, gear, rpm, pedals, DRS
│   ├── BattleControls.tsx       # 1v1 transport: play, speed, scrubber, change drivers
│   ├── BattleDialog.tsx         # 1v1 setup + battle screen + lap playhead
│   ├── BattleTrack.tsx          # ghost cars on the circuit, progress ribbons
│   ├── Calendar.tsx
│   ├── CircuitInfo.tsx          # circuit info popup: layout, facts, racing history
│   ├── ConstructorStandings.tsx
│   ├── DriverStandings.tsx
│   ├── FeaturedEvent.tsx        # full panel + compact bar
│   ├── Feedback.tsx             # Loading / ErrorState / Empty
│   ├── Header.tsx               # brand mark + wordmark + theme switch
│   ├── Home.tsx                 # featured event + the newest headlines
│   ├── Modal.tsx                # native <dialog> shell for the details popup
│   ├── NewsPanel.tsx            # the headline list, shared by home and the section
│   ├── Position.tsx             # team-coloured position chip
│   ├── RaceResults.tsx          # round + session selection, Table | Grid toggle
│   ├── ReplayControls.tsx       # replay transport: play, speed, scrubber
│   ├── ReplayDialog.tsx         # replay shell: loading states + playback clock
│   ├── ReplayLeaderboard.tsx    # replay standings tower
│   ├── ReplayMap.tsx            # replay circuit outline + moving cars
│   ├── ReplayPace.tsx           # race pace graph: lap time, driver filter chips
│   ├── ReplayTrackStatus.tsx    # safety car / VSC / red / yellow banner over the map
│   ├── ReplayWeather.tsx        # track conditions strip above the map
│   ├── RowMenu.tsx              # schedule row actions behind a kebab on a phone
│   ├── SeasonView.tsx           # nav tabs, shared season state, circuit info dialog
│   ├── SessionResultTable.tsx   # one table per session format
│   ├── StartingGridView.tsx     # qualifying as a staggered grid of plates
│   └── Tabs.tsx
├── hooks/
│   ├── useFetch.ts              # abortable fetch hook with reload + background refresh
│   ├── useMediaQuery.ts         # width queries, for layout CSS cannot switch
│   └── useTheme.ts              # light/dark theme: read, toggle, remember
├── lib/
│   ├── battle.ts                # 1v1 lap normalisation, distance gap, sector deltas
│   ├── battleCache.ts           # IndexedDB cache for finished 1v1 battles
│   ├── battleSource.ts          # 1v1 session picker + lap-sized telemetry loader
│   ├── circuit.ts               # replay geometry: rotate, fit, project x/y to SVG
│   ├── circuitHistory.ts        # past winners → editions, records, recent winners
│   ├── circuits.ts              # circuit track layouts: Ergast id → vendored SVG
│   ├── format.ts                # date, time and gap formatting
│   ├── grid.ts                  # qualifying classification → grid slots and gaps
│   ├── pace.ts                  # replay lap times → race-pace series
│   ├── replay.ts               # replay timeline, interpolation, standings, encoding
│   ├── replayCache.ts          # IndexedDB cache for fallback downloads
│   ├── replaySource.ts         # baked-first loader with OpenF1 fallback
│   └── schedule.ts              # weekend windows, session codes, race-day status
├── App.tsx                      # resolves the current season
├── index.css                    # theme tokens + all styling
├── main.tsx
└── shared/                      # pure modules imported by the app and the Worker
    ├── alpha.ts                 # alpha envelope unwrap
    ├── openf1Map.ts             # OpenF1 rows → the alpha table shape
    ├── results.ts               # wire types, completeness, hashing, state rank
    └── schedule.ts              # UTC session windows and codes

worker/
├── src/
│   ├── index.ts                 # fetch + scheduled handlers, routing
│   ├── config.ts                # bindings, timeouts, retry policy
│   ├── cache.ts                 # KV keys + the revision/state guard
│   ├── schedule.ts              # calendar, round ids, OpenF1 session list
│   ├── results.ts               # refresh, promotion and final-recheck state machine
│   └── sources/
│       ├── jolpica.ts           # canonical results + metadata
│       └── openf1.ts            # provisional fallback + grid enrichment
├── test/                        # Vitest suite and small fixtures
└── tsconfig.json

public/
├── apple-touch-icon.png         # 180x180 touch icon
├── favicon-32x32.png            # PNG favicon
├── favicon.ico                  # multi-size favicon (16/32/48)
├── icon-192.png                 # PWA icon
├── icon-512.png                 # PWA icon
├── icon-maskable-512.png        # maskable PWA icon
├── logo.png                     # header brand mark
├── og-image.png                 # social preview card (1200x630)
├── og-image-square.png          # square social card (1080x1080)
├── site.webmanifest             # web app manifest
├── fonts/
│   ├── archivo-latin-wdth-normal.woff2    # variable font: weight + width axes
│   └── archivo-latin-wdth-italic.woff2    # true italic face for first-level titles
├── circuits.json                # baked replay geometry, one entry per circuit
├── replays/                     # baked replays, one file per session_key
│   ├── index.json               # season + date + code → session_key
│   └── {session_key}.json       # timeline + timing + weather + circuit (see "Race replay")
└── circuits/                    # vendored circuit track layouts (see "Circuit images")
    ├── LICENSE.txt              # MIT licence of the layout artwork
    └── *.svg                    # one file per historical layout, e.g. monza-6.svg

scripts/
├── build-replays.mjs            # bakes public/replays from OpenF1
└── results-readiness.mjs        # samples how soon results are published

vercel.json                          # production: news feeds + results Worker rewrites
wrangler.jsonc                       # Worker name, KV binding, cron, vars
worker-configuration.d.ts            # generated Cloudflare bindings/runtime types
vitest.config.ts                     # Worker/shared test runner
```

## Notes

- Race dates and times are rendered in the **visitor's timezone**. Dates arrive from the API in
  UTC and are converted for display, except for bare dates with no time attached, which are
  calendar days and are shown as written.
- Team colours for the standings come from a small local map
  (`src/api/teams.ts`); session results use the exact colour the alpha API returns. Either way
  the colour fills the position chip, and the chip's text colour is chosen from the livery's
  luminance so it stays readable.
- On a phone the driver column drops the full name and keeps only the three-letter code. The
  name is the widest thing in the row and is what would otherwise push the qualifying table
  into sideways scroll; it stays in the markup for screen readers, so nothing is lost to
  assistive tech. Constructors have no code to fall back on, so they keep their full name.
- On a phone the schedule's two row buttons fold into a kebab menu (`RowMenu`), because an
  inline Info and Results button on every row leaves no width for the race name and date;
  desktop keeps them inline. The menu is portalled to the body and pinned to the viewport,
  since the table scrolls inside an `overflow: hidden` panel that would otherwise clip
  anything anchored to a row.
- Qualifying and practice positions show the numeric position. The alpha API marks drivers
  who set no time in a final segment as `NC` / not classified while still ordering them, so
  the numeric position keeps the table readable and a blank segment column shows the cause.
- The alpha API reports each car's **own elapsed time** in race and sprint results, not a
  gap. For a car that retired early that time is *shorter* than the winner's, so the raw
  value would show a retirement as the fastest car on track. The Time/Status column is
  therefore rebuilt from the leader's laps and time: the winner's total, a gap for cars on
  the lead lap, `+1 Lap` for cars a lap down, and the status for retirements.
- The upstream APIs are free and rate limited. Session results are cached by the Worker, so
  selecting the same round and session again is served from KV rather than refetched; the
  calendar and standings still come straight from jolpica.
- The link-preview tags in `index.html` (`og:*` and `twitter:*`) are pinned to the deployed
  origin, `https://boxthislap.vercel.app`, because `og:url` and `og:image` have to be
  absolute URLs — update them if the site moves. The cards (`public/og-image.png`,
  `public/og-image-square.png`) are rendered from the app's own tokens and font.

# Box this Lap!

Live standings and updates from the pit wall.

A small, clean React app for browsing Formula 1 results and championship standings,
powered by the free [jolpica-f1](https://github.com/jolpica/jolpica-f1) API.

## Features

- **The Pit Wall** — the next or current race at full size, plus a placeholder for the news feed
- **The Schedule** — every round of the season with circuit, location and date. Completed rounds
  open their results; rounds still to come open a details panel instead, since there is
  nothing to show yet
- **The Grid** — driver championship table, with each position in a team-coloured chip
- **Constructors** — team championship table
- **Chequered Flag** — every session of a weekend: practice 1–3, sprint qualifying,
  qualifying, the sprint and the race
- The featured event stays visible in every section as a compact bar that links back to
  The Pit Wall
- Dates and times are shown in **your own timezone**, not the circuit's
- Loading, empty and error states with retry, and full keyboard/ARIA support

The app follows the **season in progress**. There is no season picker: the current season is
resolved from the API and shown in The Schedule panel, which is titled with it (for example
`2026 Calendar`).

The section names above are the tab labels. Each tab keeps a stable id (`home`, `calendar`,
`drivers`, `constructors`, `results`) for its ARIA wiring.

## Navigation

| Section | Content |
| --- | --- |
| **The Pit Wall** | Full-size featured-event panel + news placeholder |
| **The Schedule** | Round list with the featured race highlighted; future rounds open a details panel |
| **The Grid** | Driver championship table |
| **Constructors** | Constructor championship table |
| **Chequered Flag** | Every session of a selected round |

Every section except The Pit Wall shows `FeaturedEventBar`, a one-line summary of the featured
event. Clicking it returns to The Pit Wall. The bar hides the circuit and date details on
narrow screens, keeping the race name and countdown.

## Look and feel

The app is styled after the [Golden Lap](https://www.funselektor.com/goldenlap) interface:
flat, warm and retro. Cream "paper" panels sit on a soft pastel haze, text is near-black
ink, and a single warm red carries every call to action. The header pairs a headset-wearing
pit-wall operator mark with the name **Box this Lap!** and its tagline, "Live standings and
updates from the pit wall."

- **Type** — one variable font, [Archivo](https://fonts.google.com/specimen/Archivo), served
  from `public/fonts`. Its two axes do the whole job: headings and labels are set condensed
  (`font-stretch: 78%`) in uppercase caps, while tables and body copy stay at normal width.
  Self-hosting keeps a third party off the critical path, and the file is preloaded because
  the stylesheet references it immediately.
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

There is no dark variant; the theme is defined on custom properties, so one could be added by
overriding them.

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

- **Which sessions a round has comes from the API**, not from a guess. Each round is asked
  for its list of available results, so a sprint weekend correctly offers practice 1, sprint
  qualifying, the sprint, qualifying and the race, while a normal weekend offers practice
  1–3, qualifying and the race.
- **The opening session is the most recent one that has already started.** Visiting a round
  mid-weekend lands on whatever just ran — during a Friday practice the app opens on practice
  1 rather than jumping ahead to the race.
- Sessions with no data yet show an explicit "not available yet" notice, which is the normal
  case for rounds still to come.

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

`TODAY` is resolved once at module load in `src/lib/schedule.ts`. For a long-running
deployment you would want to refresh it (for example on an interval or on tab focus).

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

## How the API is called

The jolpica-f1 API asks clients to send a custom `User-Agent`, but browsers forbid
JavaScript from setting that header. To satisfy the API without adding a backend,
`vite.config.ts` proxies two prefixes to `https://api.jolpi.ca` and attaches the header
server-side:

| Prefix | Upstream |
| --- | --- |
| `/ergast` | the Ergast-compatible endpoints |
| `/f1` | jolpica's own alpha endpoints |

The same proxies are configured for `vite preview`, so both `dev` and `preview` work out of
the box.

Endpoints used:

| View | Endpoint |
| --- | --- |
| The Schedule + current season | `/ergast/f1/current/races/?limit=100` |
| The Grid | `/ergast/f1/{season}/driverstandings/?limit=100` |
| Constructors | `/ergast/f1/{season}/constructorstandings/?limit=100` |
| Round ids for the season | `/f1/alpha/core/rounds/?year={season}` |
| Sessions a round has | `/f1/alpha/results/{roundId}/` |
| One session's results | `/f1/alpha/results/{roundId}/{code}/` |

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
│   ├── teams.ts     # team colours + readable chip ink
│   └── types.ts     # response types for both API layers
├── components/
│   ├── Calendar.tsx
│   ├── ConstructorStandings.tsx
│   ├── DriverStandings.tsx
│   ├── FeaturedEvent.tsx        # full panel + compact bar
│   ├── Feedback.tsx             # Loading / ErrorState / Empty
│   ├── Header.tsx               # brand mark + wordmark
│   ├── Home.tsx                 # featured event + news placeholder
│   ├── Modal.tsx                # native <dialog> shell for the details popup
│   ├── NewsPlaceholder.tsx      # empty box for the future news feed
│   ├── Position.tsx             # team-coloured position chip
│   ├── RaceResults.tsx          # round + session selection
│   ├── SeasonView.tsx           # nav tabs + shared season state
│   ├── SessionResultTable.tsx   # one table per session format
│   └── Tabs.tsx
├── hooks/
│   └── useFetch.ts              # abortable fetch hook with reload
├── lib/
│   ├── format.ts                # date, time and gap formatting
│   └── schedule.ts              # weekend windows, session codes, race-day status
├── App.tsx                      # resolves the current season
├── index.css                    # theme tokens + all styling
└── main.tsx

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
└── fonts/
    └── archivo-latin-wdth-normal.woff2   # variable font: weight + width axes
```

## Notes

- Race dates and times are rendered in the **visitor's timezone**. Dates arrive from the API in
  UTC and are converted for display, except for bare dates with no time attached, which are
  calendar days and are shown as written.
- Team colours for the standings come from a small local map
  (`src/api/teams.ts`); session results use the exact colour the alpha API returns. Either way
  the colour fills the position chip, and the chip's text colour is chosen from the livery's
  luminance so it stays readable.
- Qualifying and practice positions show the numeric position. The alpha API marks drivers
  who set no time in a final segment as `NC` / not classified while still ordering them, so
  the numeric position keeps the table readable and a blank segment column shows the cause.
- The alpha API reports each car's **own elapsed time** in race and sprint results, not a
  gap. For a car that retired early that time is *shorter* than the winner's, so the raw
  value would show a retirement as the fastest car on track. The Time/Status column is
  therefore rebuilt from the leader's laps and time: the winner's total, a gap for cars on
  the lead lap, `+1 Lap` for cars a lap down, and the status for retirements.
- The API is free and rate limited; responses are not cached, so each round and session
  selection refetches.
- The link-preview tags in `index.html` (`og:*` and `twitter:*`) point at a placeholder
  origin, `https://boxthislap.example`. Swap it for the real production domain before
  deploying, since `og:url` and `og:image` have to be absolute URLs. The cards themselves
  (`public/og-image.png`, `public/og-image-square.png`) are already in place.

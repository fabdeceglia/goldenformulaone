# Box this Lap!

Live standings and updates from the pit wall.

A small, clean React app for browsing Formula 1 results and championship standings,
powered by the free [jolpica-f1](https://github.com/jolpica/jolpica-f1) API.

## Features

- **The Pit Wall** — the next or current race at full size, plus the five newest headlines
  from the paddock
- **Paddock and Coffee** — the paddock press, merged from five outlets and sorted newest first
- **The Schedule** — every round of the season with circuit, location and date. Completed rounds
  open their results; rounds still to come open a details panel instead, since there is
  nothing to show yet. Every round also offers an **Info** popup with the circuit's track
  layout and racing history
- **The Grid** — driver championship table, with each position in a team-coloured chip
- **Constructors** — team championship table
- **Chequered Flag** — every session of a weekend: practice 1–3, sprint qualifying,
  qualifying, the sprint and the race. Qualifying can also be read as a **Starting
  Grid**, laid out the way the cars line up
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

- **Which sessions a round has comes from the API**, not from a guess. Each round is asked
  for its list of available results, so a sprint weekend correctly offers practice 1, sprint
  qualifying, the sprint, qualifying and the race, while a normal weekend offers practice
  1–3, qualifying and the race.
- **The opening session is the most recent one that has already started.** Visiting a round
  mid-weekend lands on whatever just ran — during a Friday practice the app opens on practice
  1 rather than jumping ahead to the race.
- Sessions with no data yet show an explicit "not available yet" notice, which is the normal
  case for rounds still to come.

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

`TODAY` is resolved once at module load in `src/lib/schedule.ts`. For a long-running
deployment you would want to refresh it (for example on an interval or on tab focus).

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

## How the API is called

The jolpica-f1 API asks clients to send a custom `User-Agent`, but browsers forbid
JavaScript from setting that header. To satisfy the API without adding a backend,
`vite.config.ts` proxies two prefixes to `https://api.jolpi.ca` and attaches the header
server-side. The news feeds go through the same proxy for a different reason — RSS is served
without CORS headers — and are listed with the rest:

| Prefix | Upstream |
| --- | --- |
| `/ergast` | the Ergast-compatible endpoints |
| `/f1` | jolpica's own alpha endpoints |
| `/news/<id>` | one feed per outlet, one path each |

The same proxies are configured for `vite preview`, so both `dev` and `preview` work out of
the box. Production is a static build on Vercel, which has no dev server: `vercel.json`
rewrites the five `/news/<id>` paths to the feeds there, and the app talks to jolpica
directly, because that API does send CORS headers (set `VITE_API_BASE` and `VITE_ALPHA_BASE`
to the absolute URLs at build time).

Endpoints used:

| View | Endpoint |
| --- | --- |
| The Schedule + current season | `/ergast/f1/current/races/?limit=100` |
| The Grid | `/ergast/f1/{season}/driverstandings/?limit=100` |
| Constructors | `/ergast/f1/{season}/constructorstandings/?limit=100` |
| Circuit info (history) | `/ergast/f1/circuits/{circuitId}/results/1/?limit=100` |
| Round ids for the season | `/f1/alpha/core/rounds/?year={season}` |
| Sessions a round has | `/f1/alpha/results/{roundId}/` |
| One session's results | `/f1/alpha/results/{roundId}/{code}/` |
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
│   ├── teams.ts     # team colours + readable chip ink
│   └── types.ts     # response types for both API layers
├── components/
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
│   ├── SeasonView.tsx           # nav tabs + shared season state
│   ├── SessionResultTable.tsx   # one table per session format
│   ├── StartingGridView.tsx     # qualifying as a staggered grid of plates
│   └── Tabs.tsx
├── hooks/
│   ├── useFetch.ts              # abortable fetch hook with reload
│   └── useTheme.ts              # light/dark theme: read, toggle, remember
├── lib/
│   ├── circuitHistory.ts        # past winners → editions, records, recent winners
│   ├── circuits.ts              # circuit track layouts: Ergast id → vendored SVG
│   ├── format.ts                # date, time and gap formatting
│   ├── grid.ts                  # qualifying classification → grid slots and gaps
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
├── fonts/
│   └── archivo-latin-wdth-normal.woff2   # variable font: weight + width axes
└── circuits/                    # vendored circuit track layouts (see "Circuit images")
    ├── LICENSE.txt              # MIT licence of the layout artwork
    └── *.svg                    # one file per historical layout, e.g. monza-6.svg

vercel.json                          # production: proxies the news feeds
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
- The link-preview tags in `index.html` (`og:*` and `twitter:*`) are pinned to the deployed
  origin, `https://boxthislap.vercel.app`, because `og:url` and `og:image` have to be
  absolute URLs — update them if the site moves. The cards (`public/og-image.png`,
  `public/og-image-square.png`) are rendered from the app's own tokens and font.

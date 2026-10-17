# F1 Explorer

A small, clean React app for browsing Formula 1 results and championship standings,
powered by the free [jolpica-f1](https://github.com/jolpica/jolpica-f1) API.

## Features

- **Home** — the next or current race at full size, plus a placeholder for the news feed
- **Calendar** — every round of the season with circuit, location and UTC date
- **Driver standings** — championship table, with team colour accents
- **Constructor standings** — team championship table
- **Session results** — every session of a weekend: practice 1–3, sprint qualifying,
  qualifying, the sprint and the race
- The featured event stays visible in every section as a compact bar that links back to Home
- Loading, empty and error states with retry, and full keyboard/ARIA support

The app follows the **season in progress**. There is no season picker: the current season is
resolved from the API and shown in the header.

## Navigation

| Section | Content |
| --- | --- |
| **Home** | Full-size featured-event panel + news placeholder |
| **Calendar** | Round list with the featured race highlighted |
| **Drivers** | Driver championship table |
| **Constructors** | Constructor championship table |
| **Results** | Every session of a selected round |

Every section except Home shows `FeaturedEventBar`, a one-line summary of the featured
event. Clicking it returns to Home. The bar hides the circuit and date details on narrow
screens, keeping the race name and countdown.

## Session results

The Results section shows every session the API can serve for a round, selected with a
segmented control under the round picker. Sessions are listed in the order the weekend runs
them.

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

## The featured event

The home screen shows a panel for the event that matters right now. Its logic lives in
`src/lib/schedule.ts` and works on **date-only** string comparisons in UTC:

1. Each race gets a **weekend window**: from its earliest session (`FirstPractice`,
   `SprintQualifying`, …) through to race day.
2. If today falls inside a window, that race is featured. It is labelled **Race day**
   when today is the race date, otherwise **Race weekend**.
3. Otherwise the next race whose window has not started yet is featured, labelled
   **Next up** with a countdown.
4. Once the season is finished, the final round is shown as the **Season finale** so the
   layout stays consistent.

The featured race is also highlighted in the calendar table.

Worked example, 2026 season — Singapore is 9–11 Oct and the USA is 23–25 Oct:

| Today | Featured |
| --- | --- |
| 10 Oct 2026 | Singapore Grand Prix (`live`) |
| 17 Oct 2026 | United States Grand Prix (`upcoming`, in 6 days) |
| 11 Oct 2026 | Singapore Grand Prix (`raceDay`) |
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
| Calendar + current season | `/ergast/f1/current/races/?limit=100` |
| Driver standings | `/ergast/f1/{season}/driverstandings/?limit=100` |
| Constructor standings | `/ergast/f1/{season}/constructorstandings/?limit=100` |
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
│   ├── teams.ts     # constructorId -> team colour fallback
│   └── types.ts     # response types for both API layers
├── components/
│   ├── Calendar.tsx
│   ├── ConstructorStandings.tsx
│   ├── DriverStandings.tsx
│   ├── FeaturedEvent.tsx        # full panel + compact bar
│   ├── Feedback.tsx             # Loading / ErrorState / Empty
│   ├── Header.tsx               # brand + current season
│   ├── Home.tsx                 # featured event + news placeholder
│   ├── NewsPlaceholder.tsx      # empty box for the future news feed
│   ├── RaceResults.tsx          # round + session selection
│   ├── SeasonView.tsx           # tabs + shared season state
│   ├── SessionResultTable.tsx   # one table per session format
│   ├── Tabs.tsx
│   └── TeamBar.tsx              # colour accent + position badge
├── hooks/
│   └── useFetch.ts              # abortable fetch hook with reload
├── lib/
│   ├── format.ts                # date, time and gap formatting
│   └── schedule.ts              # weekend windows, session codes, featured event
├── App.tsx                      # resolves the current season
├── index.css                    # all styling
└── main.tsx
```

## Notes

- Race dates and times are rendered in **UTC**, matching the raw API values.
- Team colours for the standings come from a small local map
  (`src/api/teams.ts`); session results use the exact colour the alpha API returns.
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

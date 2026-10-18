# Where to Watch — Feature Plan

> Status: **planning**. No implementation yet.
> Owner: Fabrizio · Created: 2026-10-18
> Folder note: `docs/` sits outside the Vite build (the build only bundles
> `index.html` + `src/` and copies `public/`), so this document is version-controlled
> but **never shipped** in `dist/`.

---

## 1. Goal

Tell the visitor **which channel carries Formula 1 where they are**, in one quiet line,
without leaving the app: *"Watching from Italy? Sky Italia has every session."*

The subject is the **featured event** — the race the app is already leading with — so the
line belongs on *The Pit Wall*, near the hero it describes. It is a suggestion, not a
claim: one click to correct the country, and no false precision.

---

## 2. Why there is no API to call (evidence gathered 2026-10-18)

This was searched before planning. There is **no free, official API** for broadcaster
data. F1 publishes the list as a web page and nothing else.

| Candidate | What it offers | Why it is not the source |
| --- | --- | --- |
| [F1 Broadcast Information](https://www.formula1.com/en/information/f1-broadcast-information.45y3LNsT1D6VoK0ZmX8ciJ) | The authoritative table: ~70 territories → broadcaster(s), with links | HTML page only. No API, no JSON, no per-race detail |
| [TheSportsDB](https://www.thesportsdb.com/documentation) | Real TV endpoints: `lookuptv.php?id={event}` (free tier **2 per event**), v2 filters `/filter/tv/country/{country}` and `/filter/tv/sport/motorsport` | Country/sport filters are **premium ($9/mo)**; crowd-sourced, and its F1 TV coverage is thin |
| Commercial EPGs (Gracenote, Sportmonks TV stations, Sportradar) | Per-event channel listings at licence grade | Paid contracts, and the shape is wrong: Sportmonks TV is football, Sportradar's F1 feed is results |
| jolpica / Ergast, OpenF1, API-Sports F1 | F1 results and timing | **No broadcaster data at all** |
| `api.formula1.com` (the key visible in F1 TV's config) | F1 TV subscriber account API | Not a listings API, keyed and unofficial; using it breaches their terms and would break without warning |

**One structural fact worth internalising:** broadcast rights are sold **per territory,
per season** — not per race. "Who broadcasts this race" is really "who has F1 in your
country this year", the same answer for every round. The only per-round variance is
free-to-air splits (Austria: ORF and Servus TV take 12 races each; the UK: Sky has every
session live, Channel 4 carries highlights plus a few live weekends). A per-event
broadcaster feed does not exist because the data is not shaped that way.

**Conclusion:** the honest implementation is a **small static data file**, refreshed once
per season — not a live integration.

---

## 3. Scope

### In scope (v1)

- One line on *The Pit Wall*, inside the featured-event hero: the visitor's territory and
  its broadcaster(s), with the free-to-air caveat where one exists.
- A country **guess** from the browser, and an override the visitor can set (a real
  `<select>`), remembered in `localStorage`.
- Static data transcribed from F1's published table, stamped with the season it describes.

### Explicitly out of scope

- Any live/third-party lookup at runtime — no geo-IP call, no EPG, no TheSportsDB.
- Per-race or per-session channel detail (does not exist as a product).
- Program start times / "build-up begins at" — that is an EPG's job, not ours.
- A browsable directory of every territory (v1 shows *your* territory + a picker).
- Radio broadcasters.

---

## 4. The data

### 4.1 Shape

`src/data/broadcasters.ts` (new — the repo's first `src/data/`), a typed constant:

```ts
/** How you get at it. `mixed` = free-to-air with a paid partner (e.g. UK). */
type Access = 'free' | 'pay' | 'mixed'

interface Broadcaster {
  name: string
  /** Deep link to the broadcaster's F1 page where one exists. */
  url?: string
  access: Access
}

interface Territory {
  /** ISO 3166-1 alpha-2, lower case — or a synthetic key for a group row. */
  code: string
  /** Display label, exactly as F1 prints it ("United Kingdom & Republic of Ireland"). */
  label: string
  /** Where the visitor's browser is, by timezone — the first detection signal. */
  tz: string[]
  broadcasters: Broadcaster[]
  /** The free-to-air caveat, in the app's voice. */
  note?: string
}

/** Shorthand so a row stays readable on one line. */
const b = (name: string, url: string | undefined, access: Access): Broadcaster =>
  ({ name, url, access })

export const DATA_SEASON = '2026'
export const TERRITORIES: Territory[] = [
  {
    code: 'gb',
    label: 'United Kingdom & Republic of Ireland',
    tz: ['Europe/London', 'Europe/Dublin'],
    broadcasters: [b('Sky Sports', 'https://www.skysports.com/f1', 'pay'), b('Channel 4', undefined, 'mixed')],
    note: 'Sky carries every session live; Channel 4 has highlights and a few live weekends.',
  },
  // … one row per territory, see Appendix A
]
```

**Size:** ~70 rows, a few kB raw, roughly **1.5 kB gzipped**. Nothing is fetched.

### 4.2 Group rows

F1's table mixes countries with regions — `Africa`, `Latin America`, `Caribbean`, `MENA`,
`Eurasia`, `Papua New Guinea & Pacific Islands`, `In-Ship & In-Flight`. These need a
one-time membership map so a visitor from, say, Guatemala resolves to `Latin America`:

```ts
/** Countries with no row of their own, grouped under the row that covers them. */
const GROUP_MEMBERS: Record<string, string[]> = {
  africa: ['dz','ao','bj', /* … */],
  'latin-america': ['ar','bo','cl', /* … */],
  // …
}
```

Keep it to the groups F1 actually prints — it is a short list of ISO codes, not a world
atlas. If a country is in neither the rows nor a group, the line simply does not render.

### 4.3 Staleness, stated rather than hidden

Rights move every season (the 2026 US switch from ESPN to Apple TV is exactly the failure
mode). So:

- `DATA_SEASON` is compared with the season the app is showing.
- If they differ, the line says `as of 2026` next to it — still useful, honestly labelled.
- Refreshing is a **yearly task**: re-transcribe Appendix A from the F1 page, bump
  `DATA_SEASON`, run the check script.

---

## 5. Detection and resolution

### 5.1 Guessing the country

Pure helper in `src/lib/watch.ts` (new), no network:

```ts
export function guessTerritory(now: Date, locale: string): Territory | null
```

1. **Stored choice** wins (`btl:country` in `localStorage`) — the visitor always beats the
   guess.
2. **Timezone** next: `Intl.DateTimeFormat().resolvedOptions().timeZone` matched against
   the `tz` arrays. This is the strongest free signal — a Dutch viewer with an English
   browser still gets `Europe/Amsterdam`.
3. **Locale region** as a tiebreaker: `new Intl.Locale(locale).maximize().region`.
4. **Group fallback:** if the country is only in `GROUP_MEMBERS`, return the group row
   (labelled "Latin America", say) with a looser note.
5. Otherwise `null` → render nothing but the picker invitation.

`localStorage` is new to this app; keep it to one key, read defensively (a throw inside a
`try/catch` — Safari private mode), and never make the line depend on it.

### 5.2 Resolving the broadcaster

```ts
export function describeWatch(territory: Territory, season: string): {
  headline: string      // "Sky Sports has every session"
  detail?: string       // "Channel 4 carries highlights and a few live weekends."
  stale: boolean
}
```

Adding this shapes-cleanly now means the eventual *Calendar details* line (Phase 3) is a
second call site, not a rewrite.

---

## 6. UI / UX

### 6.1 Where the line lives

Inside the existing **featured-event hero**, in its meta column under the dates — the hero
is already "the event", so the viewing advice reads as part of it and costs no new panel.

```
┌ THE PIT WALL ── hero ─────────────────────────────┐
│ SINGAPORE GRAND PRIX        ROUND 18              │
│ Marina Bay Street Circuit · Singapore             │
│ FP1 … QUALIFYING … RACE  (local times)            │
│ ─────────────────────────────────────────────────  │
│ 📺 Watching from Singapore? beIN SPORTS           │
│    has every session.  [ not your country? ]      │
└───────────────────────────────────────────────────┘
```

- One line, `--ink-muted`, same size as the hero's date rows. Not a panel, not a button.
- The broadcaster names link out where a URL exists (new tab, `rel="noreferrer"`, like the
  news rows).
- `[ not your country? ]` reveals a **native `<select>`** listing every territory row plus
  "Not listed"; choosing saves to `localStorage` and swaps the line in place.
- If the guess was a group row, the copy loosens: *"Watching from Latin America? ESPN
  carries F1 across the region."*

### 6.2 States

| State | What renders |
| --- | --- |
| Territory known, one broadcaster | `Sky Italia has every session.` |
| Territory known, several | Named in one sentence, first paid + first free-to-air made explicit |
| Free-to-air split | The `note`, verbatim in the app's voice |
| Group row | Loose copy, region named instead of a country |
| Unknown / `null` | No guess shown — just `Where to watch? Pick your country` (the select) |
| Season mismatch | The line still renders, with `as of 2026` |
| Data missing for the country | Nothing renders; no empty panel, no error |

Never an error state: this is a nice-to-have and must not be able to break the hero.

### 6.3 Accessibility & theme

- Real `<label>` + `<select>`; the reveal is a real button with `aria-expanded`.
- Underline the links (they are not buttons) — the app's existing link treatment.
- Screen reader copy: read as one sentence, not a pile of fragments. The select announces
  as *"Broadcasting country"*.
- Mobile: the line wraps under the times; the select is full width at `≤640px`, matching
  `.field__select` behaviour already in the CSS.

---

## 7. Architecture

```
src/data/broadcasters.ts   static territory table + DATA_SEASON + GROUP_MEMBERS
        ▲
src/lib/watch.ts           guessTerritory(), resolveTerritory(code), describeWatch()
        ▲
src/components/WatchLine.tsx   the line + the country picker (no fetch, no state machine)
        ▲
src/components/FeaturedEvent.tsx   renders <WatchLine /> in the hero meta column
```

- `WatchLine` holds one `useState` for the override + `localStorage` read/write. No
  `useFetch`, no loading state, no request.
- `src/lib/watch.ts` is pure and unit-testable — it takes `(date, locale, stored)` rather
  than reaching for globals, so checks can drive it directly (this is how
  `cdp-timezone-check.mjs` drives the schedule helpers today).

---

## 8. Phased plan

### Phase 0 — Data and derivation

Goal: the table and the matching logic, with no UI.

- [ ] Transcribe Appendix A into `src/data/broadcasters.ts` (countries + group rows).
- [ ] `src/lib/watch.ts`: `guessTerritory`, `resolveTerritory`, `describeWatch`.
- [ ] Unit-style checks: every territory resolves; every `tz` entry belongs to exactly one
      row; no country appears in two groups; `describeWatch` copy for one-broadcaster,
      multi-broadcaster, split and stale cases.

**Acceptance:** `node` can resolve "Europe/Rome" → Italy → Sky Italia, and "America/Bogota"
→ Latin America, with no browser involved.

### Phase 1 — The line on The Pit Wall

- [ ] `src/components/WatchLine.tsx`: the sentence, the links, the reveal + `<select>`.
- [ ] Mount it in `FeaturedEvent`'s meta column (the hero only, not the compact bar).
- [ ] `localStorage` read/write under `btl:country`, defensive against a throwing store.
- [ ] CSS: the line, the picker, the `≤640px` full-width select. No new colours.
- [ ] `README.md`: document the line, the seasonal refresh, and the attribution.

**Acceptance:** on a fresh browser in Rome the hero reads "Watching from Italy? Sky Italia
has every session"; picking another country rewrites it and survives a reload.

### Phase 2 — Check script and polish

- [ ] `watch-check.mjs` (in the same suite style as `news-scroll-check.mjs`): guessed
      country by timezone emulation, override persistence across a reload, group-row
      fallback, unknown country renders nothing but the picker, **no new network requests**
      (assert the request log is unchanged), console clean.
- [ ] Season-mismatch copy (`as of 2026`).
- [ ] Copy pass over every `note` so they all sound like the app.

**Acceptance:** the whole feature is verified without a third-party call in the log.

### Phase 3 — Extend (optional)

- [ ] The same line in the **Calendar details modal** for an upcoming round.
- [ ] A `Watching from <country>?` line in the footer of the section views, if it earns it.
- [ ] If F1 ever publishes this as JSON (or a licensed feed appears), swap the loader for a
      fetch behind the same `describeWatch` interface.

---

## 9. New / changed files (anticipated)

**New**

- `src/data/broadcasters.ts` — the territory table, `DATA_SEASON`, `GROUP_MEMBERS`.
- `src/lib/watch.ts` — guess, resolve, describe (pure).
- `src/components/WatchLine.tsx` — the line and the picker.
- `watch-check.mjs` — the suite, kept alongside the other check scripts **outside** the
  repo (they are not part of the Vite build and are not committed).

**Changed**

- `src/components/FeaturedEvent.tsx` — render the line in the hero meta column.
- `src/index.css` — the line, the picker, the mobile select.
- `README.md` — the feature, the yearly refresh, the source.

**Unchanged (deliberately)** — `src/api/*`, `vite.config.ts`, `vercel.json`: the feature
makes **no network call at all**, so there is no proxy or rewrite to add.

---

## 10. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Data ages with the season | Wrong channel shown | `DATA_SEASON` + `as of 2026` copy; yearly refresh is a listed task |
| Country guessed wrong (VPN, expat, traveller) | Wrong line, no trust | Framed as a question, one-click override, remembered |
| Timezone spans several countries | Ambiguous guess | Locale region as tiebreaker; override; group rows loose the copy |
| F1's page is copyrighted prose | Copying the table wholesale | Only the facts (territory → channel) are reproduced, credited and linked |
| Region rows need membership lists | Extra data work | Only F1's own group labels; a country outside every group renders nothing |
| New storage usage | Private-mode throws | One key, wrapped, never load-bearing |
| Clutter on the hero | Fights "simple, fast" | One muted line, no panel, no new colours; collapse the picker behind a link |
| Scope creep into EPG territory | Endless data plumbing | Explicitly out of scope (§3); per-race detail does not exist |

---

## 11. Open questions

1. **Placement** — the hero meta column (recommended), the details modal, or the footer?
2. **Detection** — timezone + locale guess (recommended, zero calls), or a one-off free
   geo-IP lookup for accuracy at the cost of a third-party request?
3. **Default when unknown** — show the picker invitation, or stay silent until the visitor
   asks?
4. **F1 TV** — mention it as a fallback line ("F1 TV is available in many territories"),
   given it is not territory-listed and the US needs Apple TV?
5. **Free/pay signalling** — mark pay/free-to-air, or just name channels?
6. **Refresh owner** — a manual yearly edit (recommended), or a small script that scrapes
   the F1 page at build time? (The latter re-introduces a dependency for a yearly task.)
7. **Group rows** — implement the membership map, or skip the region rows entirely in v1?

---

## 12. Appendix A — the 2026 table (transcribed 2026-10-18, re-verify before shipping)

Source: F1's published *Broadcast Information* page. Region rows are marked **group**.

| Territory | Broadcaster(s) |
| --- | --- |
| Africa (**group**) | SuperSport |
| Albania | DigitAlb |
| Armenia | FastSports |
| Australia | Fox Sports, Foxtel, Kayo |
| Austria | Servus TV, ORF, Sky |
| Azerbaijan | Idman Azerbaijan |
| Belgium | RTBF, Play Sports |
| Bosnia | Arena Sport |
| Brazil | TV Globo, sportv |
| Bulgaria | TV Nova |
| Cambodia | beIN SPORTS |
| Canada | RDS, RDS 2, TSN, Noovo |
| Caribbean (**group**) | Rush Sports |
| China | Shanghai TV, Guandong Television Channel, Tencent |
| Chinese Taipei | Videoland, ELTA |
| Croatia | RTL |
| Cyprus | OmegaTV |
| Czech Republic and Slovakia | Nova |
| Denmark | TV3, Viaplay |
| Estonia | Go3 Estonia, TV3 |
| Eurasia (**group**) | Setanta Sports |
| Finland | Viaplay |
| France | Canal+ |
| Germany | Sky Deutschland, RTL |
| Greece | ANT1, ANT1+ |
| Hong Kong | beIN SPORTS, Now Sports 1 & 2 |
| Hungary | M4 (MTVA Sports Channel) |
| Iceland | Viaplay |
| India | FanCode, TATA Play FanCode Sports |
| Indonesia | beIN SPORTS |
| In-Ship & In-Flight (**group**) | Sport 24, Sport 24 Extra |
| Israel | Sport 5 |
| Italy | Sky Italia |
| Japan | Fuji TV |
| Kosovo | Arena Sport, Artmotion Kosovo |
| Laos | beIN SPORTS |
| Latin America (**group**) | ESPN |
| Latvia | Go3 Latvia, TV3 |
| Lithuania | Go3 Lithuania, TV3 |
| Luxembourg | RTL Télé Lëtzebuerg |
| Macedonia | Sport Klub |
| Malaysia and Brunei | beIN SPORTS |
| Malta | PBS Malta |
| MENA (**group**) | beIN Sports |
| Mexico | TUDN, Sky Sports, Izzi |
| Montenegro | Arena Sport |
| Myanmar | Canal+ Sports, Canal+ ACTION |
| Netherlands | Viaplay |
| New Zealand | Sky NZ |
| Norway | V sport 1, Viaplay |
| Papua New Guinea & Pacific Islands (**group**) | TVWAN Sports |
| Philippines | beIN SPORTS |
| Poland | Eleven Sports |
| Portugal | DAZN |
| Romania | Antena |
| Serbia | Arena Sport |
| Singapore | beIN SPORTS |
| Slovenia | Kanal A, VOYO |
| South Korea | Coupang Play |
| Spain and Andorra | DAZN |
| Sweden | Viaplay |
| Switzerland | SRF, RSI, RTS, Sky |
| Thailand | beIN SPORTS |
| Turkey | beIN SPORTS |
| Ukraine | Setanta Ukraine |
| United Kingdom & Republic of Ireland | Sky Sports, Channel 4 |
| USA | Apple TV |
| Vietnam | TV360 |

**Free-to-air notes to fold into `note`** (from the same source and Wikipedia's broadcaster
list, 2026 season):

- **Austria** — ORF and Servus TV each show 12 races free; Sky carries everything live.
- **United Kingdom & Ireland** — Sky has every session; Channel 4 has highlights, plus a few
  live weekends (British GP included).
- **Luxembourg** — RTL carries every race.
- **Portugal** — practice sessions are free on DAZN.
- **Brazil** — Globo/Globoplay free for a share of the races; sportv has the rest live.
- **Romania** — Antena free, practice only on its digital platform.
- **USA** — Apple TV exclusive from 2026 (F1 TV live needs an Apple TV subscription).
- **Australia** — Fox Sports/Kayo, with some free-to-air coverage.

## 13. Appendix B — sources checked

- F1 Broadcast Information (the source of truth):
  `https://www.formula1.com/en/information/f1-broadcast-information.45y3LNsT1D6VoK0ZmX8ciJ`
- Wikipedia, *List of Formula One broadcasters* (2026 table + free-to-air/pay columns):
  `https://en.wikipedia.org/wiki/List_of_Formula_One_broadcasters`
- TheSportsDB API docs (TV endpoints and their limits): `https://www.thesportsdb.com/documentation`
- Sportmonks TV Stations (football-shaped, for reference): `https://docs.sportmonks.com/v3/`
- Checked and carries nothing: jolpica/Ergast, OpenF1, API-Sports F1, Sportradar racing.

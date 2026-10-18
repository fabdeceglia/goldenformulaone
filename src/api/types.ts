/**
 * Types describing the jolpica-f1 API responses.
 *
 * Two layers are in use:
 *  - the stable Ergast-compatible endpoints (`/ergast/f1/...`) for the calendar,
 *    driver/constructor standings and the featured event;
 *  - jolpica's own (alpha) endpoints (`/f1/alpha/...`) for session results,
 *    which are the only ones that expose practice and sprint qualifying.
 *
 * Every numeric-looking Ergast field is a string, exactly as the API returns it.
 * The alpha layer returns real numbers, so the two are typed separately.
 */

/* ---------- Ergast-compatible layer ---------- */

export interface MRData {
  xmlns: string
  series: string
  url: string
  limit: string
  offset: string
  total: string
}

export interface Location {
  lat: string
  long: string
  locality: string
  country: string
}

export interface Circuit {
  circuitId: string
  url: string
  circuitName: string
  Location: Location
}

export interface Driver {
  driverId: string
  permanentNumber?: string
  code?: string
  url: string
  givenName: string
  familyName: string
  dateOfBirth: string
  nationality: string
}

export interface Constructor {
  constructorId: string
  url: string
  name: string
  nationality: string
}

export interface Session {
  date: string
  time?: string
}

export interface Race {
  season: string
  round: string
  url: string
  raceName: string
  Circuit: Circuit
  date: string
  time?: string
  FirstPractice?: Session
  SecondPractice?: Session
  ThirdPractice?: Session
  Sprint?: Session
  SprintQualifying?: Session
  Qualifying?: Session
}

export interface DriverStanding {
  position: string
  positionText: string
  points: string
  wins: string
  Driver: Driver
  Constructors: Constructor[]
}

export interface ConstructorStanding {
  position: string
  positionText: string
  points: string
  wins: string
  Constructor: Constructor
}

export interface RacesResponse {
  MRData: MRData & {
    RaceTable: {
      season: string
      Races: Race[]
    }
  }
}

export interface DriverStandingsResponse {
  MRData: MRData & {
    StandingsTable: {
      season: string
      round?: string
      StandingsLists: Array<{
        season: string
        round: string
        DriverStandings: DriverStanding[]
      }>
    }
  }
}

export interface ConstructorStandingsResponse {
  MRData: MRData & {
    StandingsTable: {
      season: string
      round?: string
      StandingsLists: Array<{
        season: string
        round: string
        ConstructorStandings: ConstructorStanding[]
      }>
    }
  }
}

/**
 * One past edition of a race, carrying just its winning entry (from
 * `/circuits/{circuitId}/results/1/`). The winner's `FastestLap` is present
 * only when they also set the race's fastest lap, i.e. `rank` is `"1"`.
 */
export interface CircuitWinnerRace {
  season: string
  round: string
  url: string
  raceName: string
  Circuit: Circuit
  date: string
  time?: string
  Results: Array<{
    position: string
    Driver: Driver
    Constructor: Constructor
    grid?: string
    laps?: string
    status?: string
    Time?: { millis?: string; time?: string }
    FastestLap?: {
      rank?: string
      lap?: string
      Time?: { time?: string }
      AverageSpeed?: { units?: string; speed?: string }
    }
  }>
}

/** Every past winner at one circuit, oldest first. */
export interface CircuitResultsResponse {
  MRData: MRData & {
    RaceTable: {
      circuitId: string
      Races: CircuitWinnerRace[]
    }
  }
}

/* ---------- Alpha layer (session results) ---------- */

/**
 * The session codes the alpha results endpoint accepts. Note that qualifying is
 * stored as the Q1/Q2/Q3 and SQ1/SQ2/SQ3 segments but requested as Q / SQ.
 */
export type SessionCode = 'FP1' | 'FP2' | 'FP3' | 'SQ' | 'SR' | 'Q' | 'R'

export interface AlphaRound {
  id: string
  url: string
  number?: number
  name: string
  is_cancelled: boolean
  race_number?: number
  wikipedia?: string
}

export interface AlphaAvailableResult {
  url: string
  /** Not every value is a session this app can render, hence the loose type. */
  code: string
  title: string
}

/** Which sessions a round has, e.g. R/Q/SQ/SR/FP1 on a sprint weekend. */
export interface AlphaResultsIndex {
  year: number
  round_number: number
  round_name: string
  available_results: AlphaAvailableResult[]
}

export interface AlphaDriver {
  id: string
  abbreviation?: string
  given_name: string
  family_name: string
  nationality?: string
  country_code?: string
  country_flag?: string
  permanent_car_number?: number
}

export interface AlphaTeam {
  id: string
  name: string
  primary_color?: string
  nationality?: string
  country_code?: string
  country_flag?: string
}

/** A qualifying segment, grid slot or fastest-lap marker attached to a result. */
export interface AlphaComponent {
  key: string
  name: string
  position?: number
  time?: string
}

export interface AlphaSessionEntry {
  driver: AlphaDriver
  team: AlphaTeam
  position: number
  position_text: string
  time?: string
  is_classified?: boolean
  laps?: number
  car_number?: number
  /** Race and sprint only. */
  status?: string
  points?: number
  components?: Record<string, AlphaComponent>
}

export interface AlphaSessionResults {
  code: SessionCode
  title: string
  timestamp: string
  local_timestamp?: string
  timezone?: string
  round: { id: string; number?: number; name: string; is_cancelled?: boolean }
  circuit?: { id: string; name: string; locality?: string; country_code?: string }
  component_keys?: string[]
  results: AlphaSessionEntry[]
}

/** Alpha list endpoints answer either bare or wrapped in `{ metadata, data }`. */
export interface AlphaEnvelope<T> {
  metadata: { timestamp: string; count?: number; page_size?: number; current_page?: number }
  data: T
}

import type { AlphaSessionEntry, AlphaSessionResults, Race, SessionCode } from '../../src/api/types'
import type { CachedResult } from '../../src/shared/results'

/** A fixed instant used by every test, so dates never depend on the clock. */
export const NOW = Date.parse('2026-10-25T20:00:00Z')

const CHECKED_AT = new Date(NOW - 60_000).toISOString()

/** A normal race weekend: FP1, FP2, FP3, qualifying, race. */
export function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    season: '2026',
    round: '18',
    url: 'https://example.test/races/18',
    raceName: 'United States Grand Prix',
    Circuit: {
      circuitId: 'americas',
      url: 'https://example.test/circuits/americas',
      circuitName: 'Circuit of the Americas',
      Location: {
        lat: '30.1328',
        long: '-97.6411',
        locality: 'Austin',
        country: 'USA',
      },
    },
    date: '2026-10-25',
    time: '20:00:00Z',
    FirstPractice: { date: '2026-10-23', time: '17:30:00Z' },
    SecondPractice: { date: '2026-10-23', time: '21:00:00Z' },
    ThirdPractice: { date: '2026-10-24', time: '17:30:00Z' },
    Qualifying: { date: '2026-10-24', time: '21:00:00Z' },
    ...overrides,
  }
}

/** A sprint weekend, used to check the session mapping and ordering. */
export function makeSprintRace(overrides: Partial<Race> = {}): Race {
  return makeRace({
    FirstPractice: { date: '2026-10-23', time: '17:30:00Z' },
    SprintQualifying: { date: '2026-10-23', time: '21:00:00Z' },
    Sprint: { date: '2026-10-24', time: '17:00:00Z' },
    Qualifying: { date: '2026-10-24', time: '21:00:00Z' },
    SecondPractice: undefined,
    ThirdPractice: undefined,
    ...overrides,
  })
}

function entry(position: number, driverNumber: number, code: SessionCode): AlphaSessionEntry {
  const isRace = code === 'R' || code === 'SR'
  return {
    driver: {
      id: String(driverNumber),
      abbreviation: `D${driverNumber}`,
      given_name: `Driver ${driverNumber}`,
      family_name: 'Test',
    },
    team: { id: `team-${driverNumber}`, name: `Team ${driverNumber}` },
    position,
    position_text: String(position),
    time: `1:1${position}.000`,
    is_classified: true,
    ...(isRace ? { status: 'FINISHED', points: position === 1 ? 25 : 18 } : {}),
  }
}

/** A minimal but type-correct alpha session payload. */
export function makeSessionResults(
  code: SessionCode,
  count = 2,
  overrides: Partial<AlphaSessionResults> = {},
): AlphaSessionResults {
  return {
    code,
    title: code,
    timestamp: '2026-10-23T17:30:00Z',
    round: { id: 'round_test', number: 18, name: 'United States Grand Prix' },
    circuit: {
      id: 'americas',
      name: 'Circuit of the Americas',
      locality: 'Austin',
      country_code: 'USA',
    },
    results: Array.from({ length: count }, (_, index) => entry(index + 1, index + 1, code)),
    ...overrides,
  }
}

/** A durable result row, shaped exactly like the Worker writes it. */
export function makeCached(overrides: Partial<CachedResult> = {}): CachedResult {
  return {
    v: 2,
    revision: 1,
    season: '2026',
    round: '18',
    code: 'FP1',
    state: 'provisional',
    source: 'jolpica',
    complete: false,
    session: makeSessionResults('FP1'),
    fetchedAt: CHECKED_AT,
    checkedAt: CHECKED_AT,
    nextAttemptAt: null,
    recheckAt: null,
    sources: {
      jolpica: { state: 'ready', count: 2, complete: false, checkedAt: CHECKED_AT },
      openf1: { state: 'empty', count: 0, complete: false, checkedAt: CHECKED_AT },
    },
    ...overrides,
  }
}

/** An in-memory stand-in for the KV binding, with write counting. */
export class FakeKV {
  readonly store = new Map<string, string>()
  puts = 0

  async get(key: string, options?: { type?: string }): Promise<unknown> {
    const raw = this.store.get(key)
    if (raw === undefined) return null
    return options?.type === 'json' ? JSON.parse(raw) : raw
  }

  async put(key: string, value: string): Promise<void> {
    this.puts += 1
    this.store.set(key, value)
  }

  seed(key: string, value: unknown): void {
    this.store.set(key, JSON.stringify(value))
  }
}

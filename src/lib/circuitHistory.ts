/**
 * Turns the flat list of past winners at a circuit into the summary a circuit
 * info panel wants to show: how many times it has raced, when, who has won it
 * most, and the most recent editions.
 */
import type { CircuitWinnerRace } from '../api/types'
import { driverName } from './format'

export interface EditionWinner {
  season: string
  raceName: string
  driver: string
  constructor: string
  /** The race's fastest lap, only when the winner set it. */
  fastestLap: string | null
}

export interface CircuitHistory {
  editions: number
  firstSeason: string | null
  lastSeason: string | null
  /** Driver with the most wins (the first of any tie). */
  topDriver: { name: string; wins: number } | null
  /** Constructor with the most wins (the first of any tie). */
  topConstructor: { name: string; wins: number } | null
  /** The latest editions, most recent first. */
  recent: EditionWinner[]
}

/** The most frequent value, or null for an empty list. Ties keep the earliest. */
function mostFrequent(values: string[]): { name: string; wins: number } | null {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

  let best: { name: string; wins: number } | null = null
  for (const [name, wins] of counts) {
    if (!best || wins > best.wins) best = { name, wins }
  }
  return best
}

export function summariseCircuit(races: CircuitWinnerRace[], recentLimit = 5): CircuitHistory {
  const chronological = [...races].sort((a, b) => Number(a.season) - Number(b.season))

  const editions = chronological.map((race): EditionWinner => {
    const winner = race.Results[0]
    const fastest = winner?.FastestLap
    return {
      season: race.season,
      raceName: race.raceName,
      driver: winner ? driverName(winner.Driver) : '—',
      constructor: winner?.Constructor.name ?? '—',
      fastestLap: fastest?.rank === '1' ? (fastest.Time?.time ?? null) : null,
    }
  })

  return {
    editions: editions.length,
    firstSeason: chronological[0]?.season ?? null,
    lastSeason: chronological[chronological.length - 1]?.season ?? null,
    topDriver: mostFrequent(editions.map((entry) => entry.driver)),
    topConstructor: mostFrequent(editions.map((entry) => entry.constructor)),
    recent: editions.slice(-recentLimit).reverse(),
  }
}

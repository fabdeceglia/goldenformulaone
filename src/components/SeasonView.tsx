import { useMemo, useState } from 'react'
import { alpha } from '../api/alpha'
import type { Race } from '../api/types'
import { useFetch } from '../hooks/useFetch'
import { TODAY, findFeaturedEvent, raceDayKey } from '../lib/schedule'
import { Calendar } from './Calendar'
import { ConstructorStandings } from './ConstructorStandings'
import { DriverStandings } from './DriverStandings'
import { FeaturedEventBar } from './FeaturedEvent'
import { Home } from './Home'
import { NewsPanel } from './NewsPanel'
import { RaceResults } from './RaceResults'
import { Tabs } from './Tabs'
import type { Tab } from './Tabs'

const TABS = [
  { id: 'home', label: 'The Pit Wall' },
  { id: 'news', label: 'Paddock and Coffee' },
  { id: 'calendar', label: 'The Schedule' },
  { id: 'drivers', label: 'The Grid' },
  { id: 'constructors', label: 'Constructors' },
  { id: 'results', label: 'Chequered Flag' },
] as const satisfies readonly Tab<string>[]

type TabId = (typeof TABS)[number]['id']

interface SeasonViewProps {
  season: string
  races: Race[]
}

export function SeasonView({ season, races }: SeasonViewProps) {
  const [tab, setTab] = useState<TabId>('home')
  const [requestedRound, setRequestedRound] = useState<string | null>(null)

  const featured = useMemo(() => findFeaturedEvent(races, TODAY), [races])

  // Results are keyed by the alpha API's own opaque round ids, so resolve the
  // whole season's mapping once rather than per round.
  const { data: rounds } = useFetch(
    season ? (signal) => alpha.rounds(season, signal) : null,
    [season],
  )

  const roundIds = useMemo(
    () => new Map((rounds ?? []).map((item) => [String(item.number), item.id])),
    [rounds],
  )

  // Default to the most recently completed race, falling back to the last round.
  const defaultRound = useMemo(() => {
    if (races.length === 0) return ''
    const completed = races.filter((race) => raceDayKey(race) <= TODAY)
    return (completed[completed.length - 1] ?? races[races.length - 1]).round
  }, [races])

  const round = requestedRound ?? defaultRound

  const openRace = (selected: string) => {
    setRequestedRound(selected)
    setTab('results')
  }

  return (
    <>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* Every section keeps the upcoming/current event in view, except home
          where it is rendered at full size. */}
      {tab !== 'home' && featured && (
        <FeaturedEventBar featured={featured} onOpen={() => setTab('home')} />
      )}

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'home' && (
          <Home season={season} featured={featured} onOpenNews={() => setTab('news')} />
        )}

        {tab === 'news' && <NewsPanel variant="full" />}

        {tab === 'calendar' && (
          <Calendar
            season={season}
            races={races}
            featuredRound={featured?.race.round ?? null}
            onSelectRace={openRace}
          />
        )}

        {tab === 'drivers' && <DriverStandings season={season} />}
        {tab === 'constructors' && <ConstructorStandings season={season} />}

        {tab === 'results' && (
          <RaceResults
            season={season}
            races={races}
            round={round}
            roundId={round ? roundIds.get(round) : undefined}
            onRoundChange={setRequestedRound}
          />
        )}
      </div>
    </>
  )
}

import { useMemo, useState } from 'react'
import type { Race, SessionCode } from '../api/types'
import { useSeasonRounds } from '../hooks/useSeasonRounds'
import { TODAY, findFeaturedEvent, raceDayKey } from '../lib/schedule'
import { Calendar } from './Calendar'
import { CircuitInfoPanel } from './CircuitInfo'
import { ConstructorStandings } from './ConstructorStandings'
import { DriverStandings } from './DriverStandings'
import { FeaturedEventBar } from './FeaturedEvent'
import { Home } from './Home'
import { Modal } from './Modal'
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
  // A session the hero asked for, so "Qualifying results" lands on qualifying
  // rather than whatever the round's default session happens to be.
  const [requestedSession, setRequestedSession] = useState<SessionCode | null>(null)

  // The circuit info popup belongs to the season rather than to a section: the
  // home hero and every schedule row open the same dialog.
  const [infoRace, setInfoRace] = useState<Race | null>(null)

  const featured = useMemo(() => findFeaturedEvent(races, TODAY), [races])

  // Results are keyed by the alpha API's own opaque round ids, so resolve the
  // whole season's mapping once rather than per round. The mapping is cached
  // from a previous visit, which lets the results request start immediately.
  const {
    rounds,
    loading: roundsLoading,
    error: roundsError,
    reload: reloadRounds,
  } = useSeasonRounds(season)

  const roundIds = useMemo(
    () => new Map(rounds.map((item) => [item.number, item.id])),
    [rounds],
  )

  // Default to the most recently completed race, falling back to the last round.
  const defaultRound = useMemo(() => {
    if (races.length === 0) return ''
    const completed = races.filter((race) => raceDayKey(race) <= TODAY)
    return (completed[completed.length - 1] ?? races[races.length - 1]).round
  }, [races])

  const round = requestedRound ?? defaultRound

  const openRace = (selected: string, session?: SessionCode) => {
    setRequestedRound(selected)
    setRequestedSession(session ?? null)
    setTab('results')
  }

  // Leaving the results tab forgets the session the hero asked for; a fresh
  // visit should fall back to the round's most recent session.
  const changeTab = (next: TabId) => {
    setTab(next)
    if (next !== 'results') setRequestedSession(null)
  }

  return (
    <>
      <Tabs tabs={TABS} active={tab} onChange={changeTab} />

      {/* Every section keeps the upcoming/current event in view, except home
          where it is rendered at full size. */}
      {tab !== 'home' && featured && (
        <FeaturedEventBar featured={featured} onOpen={() => changeTab('home')} />
      )}

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'home' && (
          <Home
            season={season}
            featured={featured}
            onOpenNews={() => changeTab('news')}
            onShowCircuitInfo={setInfoRace}
            onOpenResults={openRace}
          />
        )}

        {tab === 'news' && <NewsPanel variant="full" />}

        {tab === 'calendar' && (
          <Calendar
            season={season}
            races={races}
            featuredRound={featured?.race.round ?? null}
            onSelectRace={openRace}
            onShowCircuitInfo={setInfoRace}
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
            roundsLoading={roundsLoading}
            roundsError={roundsError}
            onRetryRounds={reloadRounds}
            initialSession={requestedSession}
            onRoundChange={setRequestedRound}
          />
        )}
      </div>

      {infoRace && (
        <Modal
          label={`${infoRace.Circuit.circuitName} information`}
          onClose={() => setInfoRace(null)}
        >
          <CircuitInfoPanel race={infoRace} />
        </Modal>
      )}
    </>
  )
}

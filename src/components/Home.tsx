import type { Race, SessionCode } from '../api/types'
import type { FeaturedEvent } from '../lib/schedule'
import { Empty } from './Feedback'
import { FeaturedEventPanel } from './FeaturedEvent'
import { NewsPanel } from './NewsPanel'

/** How many headlines the home screen shows before the section takes over. */
const HOME_NEWS = 5

interface HomeProps {
  season: string
  featured: FeaturedEvent | null
  onOpenNews: () => void
  onShowCircuitInfo: (race: Race) => void
  onOpenResults: (round: string, session: SessionCode) => void
}

export function Home({
  season,
  featured,
  onOpenNews,
  onShowCircuitInfo,
  onOpenResults,
}: HomeProps) {
  return (
    <div className="home">
      {featured ? (
        <FeaturedEventPanel
          featured={featured}
          onOpenCircuitInfo={() => onShowCircuitInfo(featured.race)}
          onOpenResults={(session) => onOpenResults(featured.race.round, session)}
        />
      ) : (
        <Empty message={`No events found for the ${season} season.`} />
      )}
      <NewsPanel variant="home" limit={HOME_NEWS} onMore={onOpenNews} />
    </div>
  )
}

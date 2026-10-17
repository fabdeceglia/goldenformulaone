import type { FeaturedEvent } from '../lib/schedule'
import { Empty } from './Feedback'
import { FeaturedEventPanel } from './FeaturedEvent'
import { NewsPlaceholder } from './NewsPlaceholder'

interface HomeProps {
  season: string
  featured: FeaturedEvent | null
}

export function Home({ season, featured }: HomeProps) {
  return (
    <div className="home">
      {featured ? (
        <FeaturedEventPanel featured={featured} />
      ) : (
        <Empty message={`No events found for the ${season} season.`} />
      )}
      <NewsPlaceholder />
    </div>
  )
}

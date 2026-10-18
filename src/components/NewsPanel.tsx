import { latestNews } from '../api/news'
import { useFetch } from '../hooks/useFetch'
import { formatRelativeTime } from '../lib/format'
import { Empty, ErrorState, Loading } from './Feedback'

interface NewsPanelProps {
  /** Which screen the panel is on: the home screen shares the window with the
   *  featured event, the section has it to itself. The two size the list
   *  differently, so both views keep the page still. */
  variant: 'home' | 'full'
  /** How many headlines to show; omit to show the whole cached list. */
  limit?: number
  /** Adds a link through to the full section, for the panel on the home screen. */
  onMore?: () => void
}

/**
 * The news list, shared by the home screen (a handful of headlines) and the
 * Paddock and Coffee section (all of them). Both read the same cached merge, so
 * the two views always agree on what is new.
 */
export function NewsPanel({ variant, limit, onMore }: NewsPanelProps) {
  const { data, loading, error, reload } = useFetch(() => latestNews(), [])

  if (loading && !data) return <Loading message="Reading the paddock…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const items = data ?? []
  if (items.length === 0) return <Empty message="No news from the paddock right now." />

  const shown = limit ? items.slice(0, limit) : items

  return (
    <section className="panel panel--news" aria-labelledby="news-title">
      <div className="panel__head">
        <h2 className="panel__title" id="news-title">
          Paddock and Coffee
        </h2>
        {onMore && (
          <button type="button" className="panel__more" onClick={onMore}>
            More news
            <span aria-hidden="true"> ›</span>
          </button>
        )}
      </div>

      <ul className={`news news--${variant}`}>
        {shown.map((item) => (
          <li key={item.key}>
            <a className="news__item" href={item.url} target="_blank" rel="noreferrer">
              <span className="news__kicker">
                <span className="news__source">{item.source}</span>
                {item.published !== null && (
                  <span className="news__time">{formatRelativeTime(item.published)}</span>
                )}
              </span>
              <span className="news__headline">{item.title}</span>
              {item.summary && <span className="news__excerpt">{item.summary}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

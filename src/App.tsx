import { api } from './api/client'
import { ErrorState, Loading } from './components/Feedback'
import { Header } from './components/Header'
import { SeasonView } from './components/SeasonView'
import { useFetch } from './hooks/useFetch'

export default function App() {
  // The app follows the season in progress, so there is no season to choose.
  const { data, loading, error, reload } = useFetch(
    (signal) => api.currentRaces(signal),
    [],
  )

  const races = data?.MRData.RaceTable.Races ?? []
  const season = data?.MRData.RaceTable.season ?? ''

  return (
    <div className="app">
      <Header season={season} />

      <main className="main">
        {loading && <Loading message="Loading the season…" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && season && <SeasonView season={season} races={races} />}
      </main>

      <footer className="footer">
        <span>
          Data from the{' '}
          <a href="https://github.com/jolpica/jolpica-f1" target="_blank" rel="noreferrer">
            jolpica-f1
          </a>{' '}
          API
        </span>
      </footer>
    </div>
  )
}

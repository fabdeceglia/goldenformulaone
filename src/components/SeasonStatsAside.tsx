/**
 * The four statistics both season dialogs show. A driver's stats and a
 * constructor's aggregate share this shape; the qualifying sample counts
 * sessions for a driver and car entries for a team, hence the unit.
 */
export interface SeasonStatsSummary {
  wins: number
  retirements: number
  dns: number
  dsq: number
  avgRace: number | null
  avgQualifying: number | null
  raceSample: number
  qualifyingSample: number
}

interface SeasonStatsAsideProps {
  stats: SeasonStatsSummary | null
  qualifyingUnit?: string
}

export function SeasonStatsAside({ stats, qualifyingUnit = 'sessions' }: SeasonStatsAsideProps) {
  return (
    <aside className="stats__aside" aria-label="Season statistics">
      <dl className="stats__list">
        <Stat label="Victories" value={statValue(stats, (stats) => stats.wins)} />
        <Stat label="Retirements" value={statValue(stats, (stats) => stats.retirements)} />
        <Stat
          label="Avg finish"
          value={average(stats, (stats) => stats.avgRace)}
          hint={
            stats && stats.raceSample > 0 ? `${stats.raceSample} classified` : 'no classified races'
          }
        />
        <Stat
          label="Avg qualifying"
          value={average(stats, (stats) => stats.avgQualifying)}
          hint={
            stats && stats.qualifyingSample > 0
              ? `${stats.qualifyingSample} ${qualifyingUnit}`
              : undefined
          }
        />
      </dl>

      {stats && (stats.dns > 0 || stats.dsq > 0) && (
        <p className="stats__note">
          {[stats.dns > 0 ? `${stats.dns} DNS` : null, stats.dsq > 0 ? `${stats.dsq} DSQ` : null]
            .filter(Boolean)
            .join(' · ')}{' '}
          not counted in averages
        </p>
      )}
    </aside>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stats__stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="stats__sample">{hint}</span>}
      </dd>
    </div>
  )
}

function statValue(
  stats: SeasonStatsSummary | null,
  pick: (stats: SeasonStatsSummary) => number,
): string {
  return stats ? String(pick(stats)) : '—'
}

function average(
  stats: SeasonStatsSummary | null,
  pick: (stats: SeasonStatsSummary) => number | null,
): string {
  const value = stats ? pick(stats) : null
  return value === null ? '—' : value.toFixed(1)
}

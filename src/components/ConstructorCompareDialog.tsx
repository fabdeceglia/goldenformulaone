import { fetchConstructorCompare } from '../api/compareConstructors'
import { readableInk, teamColor } from '../api/teams'
import type { ConstructorStanding } from '../api/types'
import { CONSTRUCTOR_COMPARE_AXES } from '../lib/constructorCompare'
import type { ConstructorCompareStat } from '../lib/constructorCompare'
import { CompareDialog } from './CompareDialog'
import type { CompareRow } from './CompareDialog'

interface ConstructorCompareDialogProps {
  season: string
  /** The standings rows, which are also the picker's team list. */
  standings: readonly ConstructorStanding[]
  onClose: () => void
}

const ROWS: readonly CompareRow<ConstructorCompareStat>[] = [
  {
    id: 'wins',
    label: 'Wins',
    detail: ({ counts }) => `${counts.wins} of ${counts.starts} car starts`,
  },
  {
    id: 'poles',
    label: 'Poles',
    detail: ({ counts }) =>
      counts.qualifyingSessions === 0
        ? 'no qualifying data'
        : `${counts.poles} of ${counts.qualifyingSessions} sessions`,
  },
  {
    id: 'podiums',
    label: 'Podiums',
    detail: ({ counts }) => `${counts.podiums} of ${counts.starts} car starts`,
  },
  {
    id: 'fastestLaps',
    label: 'Fastest laps',
    detail: ({ counts }) => `${counts.fastestLaps} of ${counts.starts} car starts`,
  },
  {
    id: 'finishes',
    label: 'Finishes',
    detail: ({ counts }) => `${counts.retirements} retirements`,
  },
]

/**
 * The teams' radar. A constructor has no team-mate to beat, so its qualifying
 * axis becomes podiums; the other four keep the driver chart's meaning.
 */
export function ConstructorCompareDialog({
  season,
  standings,
  onClose,
}: ConstructorCompareDialogProps) {
  return (
    <CompareDialog
      season={season}
      title="Constructor comparison"
      label={`Constructor comparison for ${season}`}
      noun="teams"
      options={standings.map((standing) => {
        const livery = teamColor(standing.Constructor.constructorId)
        return {
          id: standing.Constructor.constructorId,
          name: standing.Constructor.name,
          detail: standing.Constructor.nationality,
          color: livery,
          ink: readableInk(livery),
        }
      })}
      initial={standings.slice(0, 2).map((standing) => standing.Constructor.constructorId)}
      axes={CONSTRUCTOR_COMPARE_AXES}
      rows={ROWS}
      idOf={(stat) => stat.constructorId}
      load={(ids, signal) => fetchConstructorCompare(season, ids, signal)}
      onClose={onClose}
    />
  )
}

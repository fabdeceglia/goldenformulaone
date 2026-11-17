import { fetchDriverCompare } from '../api/compareDrivers'
import { readableInk, teamColor } from '../api/teams'
import type { DriverStanding } from '../api/types'
import { driverName } from '../lib/format'
import { COMPARE_AXES } from '../lib/driverCompare'
import type { DriverCompareStat } from '../lib/driverCompare'
import { CompareDialog } from './CompareDialog'
import type { CompareRow } from './CompareDialog'

interface DriverCompareDialogProps {
  season: string
  /** The standings rows, which are also the picker's driver list. */
  standings: readonly DriverStanding[]
  onClose: () => void
}

const ROWS: readonly CompareRow<DriverCompareStat>[] = [
  {
    id: 'wins',
    label: 'Wins',
    detail: ({ counts }) => `${counts.wins} of ${counts.starts} starts`,
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
    id: 'qualifying',
    label: 'Qualifying vs team mate',
    detail: ({ counts }) =>
      counts.headToHeadWins + counts.headToHeadLosses === 0
        ? 'no team mate data'
        : `${counts.headToHeadWins}–${counts.headToHeadLosses}`,
  },
  {
    id: 'fastestLaps',
    label: 'Fastest laps',
    detail: ({ counts }) => `${counts.fastestLaps} of ${counts.starts} starts`,
  },
  {
    id: 'finishes',
    label: 'Finishes',
    detail: ({ counts }) => `${counts.retirements} retirements`,
  },
]

/** The drivers' radar: wins, poles, the team-mate record, fastest laps, finishes. */
export function DriverCompareDialog({ season, standings, onClose }: DriverCompareDialogProps) {
  const teamOf = new Map(
    standings.map((standing) => [
      standing.Driver.driverId,
      standing.Constructors[0]?.constructorId,
    ]),
  )

  return (
    <CompareDialog
      season={season}
      title="Driver comparison"
      label={`Driver comparison for ${season}`}
      noun="drivers"
      options={standings.map((standing) => {
        const livery = teamColor(standing.Constructors[0]?.constructorId)
        return {
          id: standing.Driver.driverId,
          name: driverName(standing.Driver),
          detail: standing.Constructors[0]?.name ?? '—',
          code: standing.Driver.code ?? standing.Driver.permanentNumber ?? '—',
          color: livery,
          ink: readableInk(livery),
        }
      })}
      initial={standings.slice(0, 2).map((standing) => standing.Driver.driverId)}
      axes={COMPARE_AXES}
      rows={ROWS}
      idOf={(stat) => stat.driverId}
      load={(ids, signal) =>
        fetchDriverCompare(
          season,
          ids.map((driverId) => ({ driverId, constructorId: teamOf.get(driverId) })),
          signal,
        )
      }
      onClose={onClose}
    />
  )
}

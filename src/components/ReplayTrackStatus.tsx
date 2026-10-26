import type { ReplayTrackStatus as ReplayTrackStatusState } from '../lib/replay'

/**
 * The track-status banner that sits over the map. It follows the race-control
 * timeline: a red flag outranks everything, then the safety car or VSC, then
 * any local yellow sectors. The whole-track flags are shown while they are
 * active; a yellow lists the marshalling sectors that are still yellow.
 */
export function ReplayTrackStatus({ status }: { status: ReplayTrackStatusState | null }) {
  if (!status) return null

  let label: string
  let chip: string
  let detail: string | null = null

  switch (status.kind) {
    case 'RED':
      label = 'Red flag'
      chip = 'RED'
      detail = 'race suspended'
      break
    case 'YELLOW':
      label = 'Yellow flag'
      chip = 'Y'
      detail = sectorDetail(status.sectors)
      break
    case 'DOUBLE YELLOW':
      label = 'Double yellow'
      chip = 'YY'
      detail = sectorDetail(status.sectors)
      break
    case 'VSC':
      label = 'Virtual Safety Car'
      chip = 'VSC'
      detail = status.phase === 'ending' ? 'ending' : null
      break
    case 'SC':
      label = 'Safety Car'
      chip = 'SC'
      detail = status.phase === 'ending' ? 'in this lap' : null
      break
  }

  return (
    <div
      className="replay__track-status"
      data-kind={status.kind}
      data-phase={status.phase ?? undefined}
      role="status"
    >
      <span className="replay__track-status-kind" aria-hidden="true">
        {chip}
      </span>
      <span className="replay__track-status-name">
        {label}
        {detail ? <span className="replay__track-status-phase"> · {detail}</span> : null}
      </span>
    </div>
  )
}

function sectorDetail(sectors: readonly number[]): string | null {
  return sectors.length > 0 ? sectors.map((sector) => `S${sector}`).join(', ') : null
}


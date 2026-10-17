import { teamColor } from '../api/teams'

interface TeamBarProps {
  constructorId?: string
  /** Preferred when known: the alpha API returns an exact team colour. */
  color?: string
}

/** Small colour accent that identifies a team without relying on logos. */
export function TeamBar({ constructorId, color }: TeamBarProps) {
  return (
    <span
      className="team-bar"
      style={{ backgroundColor: color ?? teamColor(constructorId) }}
      aria-hidden="true"
    />
  )
}

export function Position({ value, positionText }: { value: string; positionText?: string }) {
  const label = positionText ?? value
  const rank = Number(value)
  const modifier = rank >= 1 && rank <= 3 ? ` position--p${rank}` : ''
  return <span className={`position${modifier}`}>{label}</span>
}

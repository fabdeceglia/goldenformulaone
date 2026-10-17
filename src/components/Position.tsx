import { readableInk, teamColor } from '../api/teams'

interface PositionProps {
  value: string
  positionText?: string
  /** Exact colour from the alpha API, preferred when present. */
  color?: string
  /** Ergast lookup, used when no exact colour is known. */
  constructorId?: string
}

/**
 * A finishing position as a chip filled with the team's colour — the way Golden
 * Lap marks a car on the grid. Text flips to ink on pale liveries.
 */
export function Position({ value, positionText, color, constructorId }: PositionProps) {
  const background = color?.trim() ? color : teamColor(constructorId)

  return (
    <span
      className="position"
      style={{ backgroundColor: background, color: readableInk(background) }}
    >
      {positionText ?? value}
    </span>
  )
}

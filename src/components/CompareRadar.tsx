import { useMeasuredWidth } from '../hooks/useMeasuredWidth'
import type { CompareAxis } from '../lib/compare'

export interface RadarSeries {
  id: string
  /** Short name, used in the accessible summary. */
  label: string
  color: string
  values: Readonly<Record<string, number | null>>
}

interface CompareRadarProps {
  axes: readonly CompareAxis[]
  series: readonly RadarSeries[]
}

const RINGS = [0.25, 0.5, 0.75, 1]

const MAX_SIZE = 520
const MIN_SIZE = 280

/** Space outside the outer ring reserved for the spoke labels. */
const LABEL_GUTTER = 74

/**
 * A hand-drawn radar over the five 0..1 shares. Each spoke is scaled to the best
 * of the selected drivers, so the leader reaches the outer ring and the shape
 * answers "who is stronger where"; the dialog's table carries the absolute
 * numbers, which a radar alone can never show to the point.
 */
export function CompareRadar({ axes, series }: CompareRadarProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(MAX_SIZE)
  const size = Math.min(Math.max(width, MIN_SIZE), MAX_SIZE)
  const center = size / 2
  const radius = center - LABEL_GUTTER

  const angleAt = (index: number) => -Math.PI / 2 + (index * 2 * Math.PI) / axes.length

  const pointAt = (index: number, fraction: number) => {
    const angle = angleAt(index)
    return {
      x: center + Math.cos(angle) * radius * fraction,
      y: center + Math.sin(angle) * radius * fraction,
    }
  }

  // The best of the four on each axis sets that spoke's full scale. A share of
  // zero everywhere leaves the spoke at the centre rather than dividing by zero.
  const domains = axes.map((axis) =>
    series.reduce((best, entry) => Math.max(best, entry.values[axis.id] ?? 0), 0),
  )

  const fractionOf = (index: number, value: number | null): number => {
    const domain = domains[index]
    if (domain <= 0) return 0
    return Math.min(Math.max((value ?? 0) / domain, 0), 1)
  }

  const points = (fractions: readonly number[]): string =>
    fractions
      .map((fraction, index) => {
        const point = pointAt(index, fraction)
        return `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`
      })
      .join(' ')

  const labelAt = (index: number) => {
    const point = pointAt(index, 1)
    const angle = angleAt(index)
    const cos = Math.cos(angle)
    const anchor: 'start' | 'end' | 'middle' =
      Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end'
    return {
      x: Math.round(point.x + cos * 16),
      y: Math.round(point.y + Math.sin(angle) * 16),
      anchor,
    }
  }

  const ariaLabel = `Radar comparison for ${series
    .map((entry) => entry.label)
    .join(', ')}. Axes: ${axes.map((axis) => `${axis.spoke.join(' ')}, ${axis.hint}`).join('; ')}.`

  return (
    <div className="compare__radar" ref={ref}>
      <svg
        className="compare__radar-svg"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
      >
        <g aria-hidden="true">
          {RINGS.map((ring) => (
            <polygon
              key={`ring-${ring}`}
              className={`compare__radar-ring${ring === 1 ? ' compare__radar-ring--outer' : ''}`}
              points={points(axes.map(() => ring))}
            />
          ))}
          {axes.map((axis, index) => {
            const point = pointAt(index, 1)
            return (
              <line
                key={`spoke-${axis.id}`}
                className="compare__radar-spoke"
                x1={center}
                y1={center}
                x2={point.x}
                y2={point.y}
              />
            )
          })}
          {axes.map((axis, index) => {
            const label = labelAt(index)
            return (
              <g key={`label-${axis.id}`} className="compare__radar-label">
                <title>{axis.hint}</title>
                {axis.spoke.map((line, lineIndex) => (
                  <text
                    key={line}
                    x={label.x}
                    y={label.y + (lineIndex - (axis.spoke.length - 1) / 2) * 10}
                    textAnchor={label.anchor}
                    dominantBaseline="middle"
                  >
                    {line}
                  </text>
                ))}
              </g>
            )
          })}
        </g>

        {series.map((entry) => (
          <g key={entry.id} aria-hidden="true">
            <polygon
              className="compare__radar-area"
              points={points(axes.map((axis, index) => fractionOf(index, entry.values[axis.id])))}
              style={{ fill: entry.color, stroke: entry.color }}
            />
            {axes.map((axis, index) => {
              const point = pointAt(index, fractionOf(index, entry.values[axis.id]))
              return (
                <circle
                  key={`${entry.id}-${axis.id}`}
                  className="compare__radar-dot"
                  cx={point.x}
                  cy={point.y}
                  r={3}
                  style={{ fill: entry.color }}
                />
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}

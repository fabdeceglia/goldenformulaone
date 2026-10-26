/** A point in SVG user space. */
export interface CurvePoint {
  x: number
  y: number
}

/** Coordinates are rounded to one decimal place to keep path strings small. */
function coord(value: number): string {
  return value.toFixed(1)
}

/**
 * Fritsch-Carlson tangents (in dy/dx units) for a set of points. Tangents are
 * limited so each cubic segment stays monotone between its endpoints, avoiding
 * overshoot around sharp changes in the data.
 */
function monotoneTangents(points: readonly CurvePoint[]): number[] {
  const segmentCount = points.length - 1
  const slopes = new Array<number>(segmentCount)

  for (let i = 0; i < segmentCount; i += 1) {
    slopes[i] = (points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x)
  }

  const tangents = new Array<number>(points.length)
  tangents[0] = slopes[0]
  tangents[segmentCount] = slopes[segmentCount - 1]

  for (let i = 1; i < segmentCount; i += 1) {
    const before = slopes[i - 1]
    const after = slopes[i]
    tangents[i] = before * after <= 0 ? 0 : (before + after) / 2
  }

  // Apply the Fritsch-Carlson monotonicity constraint to every segment.
  for (let i = 0; i < segmentCount; i += 1) {
    const slope = slopes[i]
    if (slope === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }

    const alpha = tangents[i] / slope
    const beta = tangents[i + 1] / slope
    const magnitude = alpha * alpha + beta * beta

    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude)
      tangents[i] = scale * alpha * slope
      tangents[i + 1] = scale * beta * slope
    }
  }

  return tangents
}

/**
 * Builds a smooth SVG path through `points` using monotone cubic (Fritsch-Carlson)
 * interpolation. The curve passes through every point and does not overshoot
 * between adjacent points.
 *
 * Points are assumed to be ordered by strictly increasing x. The result is an
 * empty string for no points, a move for one point, a line for two points, and
 * a sequence of cubic Bezier (`C`) segments for three or more.
 */
export function smoothPath(points: readonly CurvePoint[]): string {
  if (points.length === 0) return ''

  const first = points[0]
  let path = `M ${coord(first.x)} ${coord(first.y)}`

  if (points.length === 1) return path

  if (points.length === 2) {
    const last = points[1]
    return `${path} L ${coord(last.x)} ${coord(last.y)}`
  }

  const tangents = monotoneTangents(points)

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    const dx = to.x - from.x

    // Convert the Hermite segment to its equivalent cubic Bezier.
    const control1X = from.x + dx / 3
    const control1Y = from.y + (tangents[i] * dx) / 3
    const control2X = to.x - dx / 3
    const control2Y = to.y - (tangents[i + 1] * dx) / 3

    path += ` C ${coord(control1X)} ${coord(control1Y)} ${coord(control2X)} ${coord(
      control2Y,
    )} ${coord(to.x)} ${coord(to.y)}`
  }

  return path
}

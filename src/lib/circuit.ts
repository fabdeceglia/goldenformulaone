/**
 * Replay circuit geometry.
 *
 * The outline and the car coordinates come from two different services, but
 * they share one x/y frame (metres). Rotating both by the circuit's rotation
 * and fitting them into one viewBox therefore keeps the cars on the line
 * without any per-circuit calibration.
 */

export interface ReplayCircuit {
  circuitKey: number
  name?: string
  /** Degrees, as published by the Multiviewer circuit endpoint. */
  rotation?: number
  /** Outline points in the same frame as the location feed. */
  outline: ReadonlyArray<readonly [number, number]>
  /** True when the line was traced from car data, not published geometry. */
  approximate?: boolean
}

export interface CircuitTransform {
  width: number
  height: number
  viewBox: string
  /** Closed SVG path for the outline, already projected. */
  outlinePath: string
  /** World x/y (metres) -> viewBox coordinates. */
  project: (x: number, y: number) => [number, number]
}

const VIEW_WIDTH = 1_000
const VIEW_HEIGHT = 720
const PADDING = 26

const cache = new Map<string, CircuitTransform>()

function cacheKey(circuit: ReplayCircuit): string {
  const rotation = circuit.rotation ?? 0
  return `${circuit.circuitKey}:${rotation}:${circuit.outline.length}`
}

/**
 * Rotates the world into the viewBox, scales it uniformly and flips y so the
 * map reads like a map (world y grows north, SVG y grows down). Memoised per
 * circuit: a replay asks for this on every animation frame otherwise.
 */
export function prepareCircuit(circuit: ReplayCircuit): CircuitTransform {
  const key = cacheKey(circuit)
  const cached = cache.get(key)
  if (cached) return cached

  const rotation = ((circuit.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  const rotate = (x: number, y: number): [number, number] => [
    x * cos - y * sin,
    x * sin + y * cos,
  ]

  const points = circuit.outline.map(([x, y]) => rotate(x, y))

  // A circuit with no outline still has cars to plot; fall back to a small
  // box so the transform never divides by zero.
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minX = points.length > 0 ? Math.min(...xs) : -1
  const maxX = points.length > 0 ? Math.max(...xs) : 1
  const minY = points.length > 0 ? Math.min(...ys) : -1
  const maxY = points.length > 0 ? Math.max(...ys) : 1
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)

  const scale = Math.min(
    (VIEW_WIDTH - PADDING * 2) / spanX,
    (VIEW_HEIGHT - PADDING * 2) / spanY,
  )
  const offsetX = (VIEW_WIDTH - spanX * scale) / 2
  const offsetY = (VIEW_HEIGHT - spanY * scale) / 2

  const project = (x: number, y: number): [number, number] => {
    const [rx, ry] = rotate(x, y)
    return [offsetX + (rx - minX) * scale, offsetY + (maxY - ry) * scale]
  }

  // `points` is already rotated for the bounding box; the path has to go
  // through `project` on the original coordinates, or it would rotate twice.
  const outlinePath =
    circuit.outline.length > 0
      ? `${circuit.outline
          .map(([x, y], index) => {
            const [sx, sy] = project(x, y)
            return `${index === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`
          })
          .join(' ')} Z`
      : ''

  const transform: CircuitTransform = {
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
    outlinePath,
    project,
  }

  cache.set(key, transform)
  return transform
}

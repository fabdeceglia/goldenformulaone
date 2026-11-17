/** Four series are the most a single radar can carry and stay readable. */
export const MAX_COMPARE_SERIES = 4

/**
 * One spoke of a comparison radar. Every axis is a share of a sample, so more
 * is always better and the spokes all read the same way.
 */
export interface CompareAxis<Id extends string = string> {
  id: Id
  /** Spoke label, one or two short lines so five of them fit around a radar. */
  spoke: readonly string[]
  /** What the axis counts, printed on hover. */
  hint: string
}

/** The part of a comparison stat the radar and the table need. */
export interface CompareStat<
  Values extends Record<string, number | null> = Record<string, number | null>,
> {
  values: Values
}

/** A count over a sample as a 0..1 share, or null when the sample is empty. */
export function share(count: number, sample: number): number | null {
  return sample > 0 ? count / sample : null
}

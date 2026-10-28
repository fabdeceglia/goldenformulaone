/**
 * jolpica's alpha list endpoints answer either with a bare payload or wrapped
 * in `{ metadata, data }`, and that has been observed to change between
 * requests. Normalising in one shared helper keeps the browser and the Worker
 * on the same shape.
 */
export function unwrapAlpha<T>(payload: T | { metadata: unknown; data: T }): T {
  if (payload && typeof payload === 'object' && 'data' in payload && 'metadata' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

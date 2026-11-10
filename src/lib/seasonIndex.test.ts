import { describe, expect, it } from 'vitest'
import { stepSeasonIndex } from './seasonIndex'

describe('stepSeasonIndex', () => {
  it('wraps the last entry forward to the first', () => {
    expect(stepSeasonIndex(19, 1, 20)).toBe(0)
  })

  it('wraps the first entry back to the last', () => {
    expect(stepSeasonIndex(0, -1, 20)).toBe(19)
  })

  it('moves normally in the middle of the list', () => {
    expect(stepSeasonIndex(4, 1, 20)).toBe(5)
    expect(stepSeasonIndex(4, -1, 20)).toBe(3)
  })

  it('keeps a closed dialog closed and leaves an empty list alone', () => {
    expect(stepSeasonIndex(null, 1, 20)).toBeNull()
    expect(stepSeasonIndex(0, 1, 0)).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { countMatches, matchRanges, normalizeQuery } from './text'

describe('text search', () => {
  it('finds case-insensitive, non-overlapping matches', () => {
    expect(matchRanges('Anna aNNa', normalizeQuery(' ANNA '))).toEqual([[0, 4], [5, 9]])
    expect(matchRanges('aaaa', 'aa')).toEqual([[0, 2], [2, 4]])
  })
  it('handles umlauts', () => {
    expect(matchRanges('Größe und GRÖSSE', normalizeQuery('größe'))).toEqual([[0, 5]])
  })
  it('counts across items', () => {
    expect(countMatches(['Seite 1', 'seite 2', ''], 'seite')).toBe(2)
    expect(countMatches(['x'], '')).toBe(0)
  })
})

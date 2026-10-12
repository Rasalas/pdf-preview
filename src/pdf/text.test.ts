import { describe, expect, it } from 'vitest'
import type { OcrPage } from '../model/ocr'
import type { Source } from '../model/types'
import { countMatches, matchPieces, matchRanges, normalizeQuery, pageStrings } from './text'

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

describe('matchPieces', () => {
  it('cuts a match across words into the parts inside each', () => {
    // Words of a recognised line carry their trailing space.
    const items = ['Sehr ', 'geehrte ', 'Frau ', 'Müller,']
    expect(matchPieces(items, 'geehrte frau')).toEqual([[{ item: 1, start: 0, end: 8 }, { item: 2, start: 0, end: 4 }]])
    expect(matchPieces(items, 'hrte fr')).toEqual([[{ item: 1, start: 3, end: 8 }, { item: 2, start: 0, end: 2 }]])
  })
  it('treats a single item like matchRanges', () => {
    expect(matchPieces(['Anna aNNa'], 'anna')).toEqual([[{ item: 0, start: 0, end: 4 }], [{ item: 0, start: 5, end: 9 }]])
    expect(matchPieces(['a', 'b'], '')).toEqual([])
  })
})

describe('pageStrings', () => {
  const image: Source = { id: 'i', name: 'scan.jpg', kind: 'image', mime: 'image/jpeg', bytes: null, pages: [{ width: 100, height: 100 }] }
  it('gives the lines of recognised text, also for sources without text of their own', async () => {
    const ocr: OcrPage = { rotation: 0, lines: [{ words: [{ text: 'Guten', x: 0, y: 0, w: 1, h: 1 }, { text: 'Tag', x: 2, y: 0, w: 1, h: 1 }] }] }
    expect(await pageStrings(image, 0, ocr)).toEqual(['Guten Tag'])
    expect(await pageStrings(image, 0)).toEqual([])
  })
})

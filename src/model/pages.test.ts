import { describe, expect, it } from 'vitest'
import { cropPages, duplicatePages, insertPages, movePages, normalizeRotation, pageNumbers, removePages, rotatePages } from './pages'
import type { Page } from './types'

const doc = (...ids: string[]): Page[] => ids.map((id, index) => ({ id, sourceId: 's', index, rotation: 0 }))
const ids = (pages: Page[]) => pages.map((p) => p.id).join('')

describe('movePages', () => {
  it('moves a page forward into a gap', () => {
    expect(ids(movePages(doc('a', 'b', 'c', 'd'), new Set(['a']), 3))).toBe('bcad')
  })
  it('moves a page backward', () => {
    expect(ids(movePages(doc('a', 'b', 'c', 'd'), new Set(['d']), 1))).toBe('adbc')
  })
  it('gathers a non-contiguous selection in document order', () => {
    expect(ids(movePages(doc('a', 'b', 'c', 'd', 'e'), new Set(['d', 'a']), 3))).toBe('bcade')
  })
  it('moves to the end', () => {
    expect(ids(movePages(doc('a', 'b', 'c'), new Set(['a', 'b']), 3))).toBe('cab')
  })
  it('returns the same array when nothing changes', () => {
    const pages = doc('a', 'b', 'c')
    expect(movePages(pages, new Set(['b']), 1)).toBe(pages)
    expect(movePages(pages, new Set(['b']), 2)).toBe(pages)
  })
})

describe('page operations', () => {
  it('inserts at a clamped position', () => {
    expect(ids(insertPages(doc('a', 'b'), doc('x'), 1))).toBe('axb')
    expect(ids(insertPages(doc('a'), doc('x'), 99))).toBe('ax')
  })
  it('removes pages', () => {
    expect(ids(removePages(doc('a', 'b', 'c'), new Set(['a', 'c'])))).toBe('b')
  })
  it('rotates and wraps around', () => {
    const [p] = rotatePages(doc('a'), new Set(['a']), -90)
    expect(p.rotation).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
  })
  it('places duplicates after their originals', () => {
    let n = 0
    const r = duplicatePages(doc('a', 'b', 'c'), new Set(['a', 'c']), () => `${++n}`)
    expect(ids(r.pages)).toBe('a1bc2')
    expect(r.copies).toEqual(['1', '2'])
  })
  it('copies the crop with a duplicate', () => {
    const pages = cropPages(doc('a'), new Map([['a', { x: 1, y: 2, w: 30, h: 40 }]]))
    const r = duplicatePages(pages, new Set(['a']), () => 'b')
    expect(r.pages.map((p) => p.crop)).toEqual([{ x: 1, y: 2, w: 30, h: 40 }, { x: 1, y: 2, w: 30, h: 40 }])
  })
})

describe('cropPages', () => {
  const rect = { x: 1, y: 2, w: 30, h: 40 }
  it('sets and clears the crop of the given pages only', () => {
    const cropped = cropPages(doc('a', 'b'), new Map([['b', rect]]))
    expect(cropped.map((p) => p.crop)).toEqual([undefined, rect])
    const cleared = cropPages(cropped, new Map([['b', undefined]]))
    expect(cleared[1]).not.toHaveProperty('crop')
  })
  it('returns the same list when nothing changes', () => {
    const pages = cropPages(doc('a'), new Map([['a', rect]]))
    expect(cropPages(pages, new Map([['a', { ...rect }]]))).toBe(pages)
    expect(cropPages(doc('a'), new Map([['a', undefined]]))).toHaveLength(1)
    const plain = doc('a')
    expect(cropPages(plain, new Map([['a', undefined]]))).toBe(plain)
  })
})

describe('pageNumbers', () => {
  it('names pages, and runs of three or more as a range', () => {
    expect(pageNumbers([3])).toBe('Seite 3')
    expect(pageNumbers([1, 2])).toBe('Seiten 1 und 2')
    expect(pageNumbers([1, 2, 3, 5])).toBe('Seiten 1–3 und 5')
    expect(pageNumbers([2, 4, 6])).toBe('Seiten 2, 4 und 6')
  })
})

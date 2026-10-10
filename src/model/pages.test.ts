import { describe, expect, it } from 'vitest'
import { duplicatePages, insertPages, movePages, normalizeRotation, removePages, rotatePages } from './pages'
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
})

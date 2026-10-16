import { describe, expect, it } from 'vitest'
import { A4 } from './pages'
import { LANDSCAPE_A4, layoutSheet, placeAt } from './sheet'
import type { PageSize, Rect } from './types'

const inside = (r: Rect, size: PageSize) => r.x >= 0 && r.y >= 0 && r.x + r.w <= size.width + 1e-6 && r.y + r.h <= size.height + 1e-6
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('layoutSheet', () => {
  it('stacks two wide screenshots on portrait A4 at one scale', () => {
    // A return label and an order summary, imported at 96 dpi.
    const { size, places } = layoutSheet([{ width: 719.25, height: 497.25 }, { width: 720, height: 734.25 }])
    expect(size).toEqual(A4)
    const [a, b] = places
    expect(a.y + a.h).toBeLessThan(b.y)
    expect(a.w / 719.25).toBeCloseTo(b.w / 720)
    expect(a.w).toBeGreaterThan(420)
    expect(places.every((r) => inside(r, size))).toBe(true)
  })

  it('never enlarges small pages', () => {
    const { places } = layoutSheet([{ width: 100, height: 50 }, { width: 80, height: 40 }])
    expect(places.map((r) => [r.w, r.h])).toEqual([[100, 50], [80, 40]])
  })

  it('turns the sheet when four landscape photos fit larger that way', () => {
    const { size, places } = layoutSheet(Array(4).fill({ width: 720, height: 497 }))
    expect(size).toEqual(LANDSCAPE_A4)
    expect(places.every((r) => inside(r, size))).toBe(true)
    for (const [i, a] of places.entries()) for (const b of places.slice(i + 1)) expect(overlap(a, b)).toBe(false)
  })
})

describe('placeAt', () => {
  it('centres on the drop point and stays on the page', () => {
    expect(placeAt({ width: 100, height: 50 }, A4, [300, 400])).toEqual({ x: 250, y: 375, w: 100, h: 50 })
    const r = placeAt({ width: 100, height: 50 }, A4, [0, 0])
    expect([r.x, r.y]).toEqual([0, 0])
  })

  it('shrinks a page larger than the host to fit inside the margins', () => {
    const r = placeAt({ width: 720, height: 734 }, A4, [300, 400])
    expect(r.w).toBeCloseTo(A4.width - 72)
    expect(inside(r, A4)).toBe(true)
  })
})

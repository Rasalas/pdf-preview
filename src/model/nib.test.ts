import { describe, expect, it } from 'vitest'
import { nibOutline } from './nib'
import type { Point } from './types'

const widthAt = (outline: Point[], x: number) => {
  const ys = outline.filter((p) => Math.abs(p[0] - x) < 3).map((p) => p[1])
  return Math.max(...ys) - Math.min(...ys)
}

describe('nibOutline', () => {
  it('draws a slow stroke fuller than a fast one', () => {
    const slow: Point[] = Array.from({ length: 100 }, (_, i) => [i, 0])
    const fast: Point[] = Array.from({ length: 10 }, (_, i) => [i * 11, 0])
    expect(widthAt(nibOutline(slow, 2), 50)).toBeGreaterThan(widthAt(nibOutline(fast, 2), 50))
  })

  it('follows stylus pressure where there is some', () => {
    const path: Point[] = Array.from({ length: 50 }, (_, i) => [i * 2, 0])
    const light = nibOutline(path, 2, path.map(() => 0.1))
    const firm = nibOutline(path, 2, path.map(() => 0.9))
    expect(widthAt(firm, 50)).toBeGreaterThan(widthAt(light, 50) * 1.5)
  })
})

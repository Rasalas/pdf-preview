import { describe, expect, it } from 'vitest'
import { bounds, mergeLineRects, resize, toPageSpace, translate, userSpaceMatrix } from './annotations'
import type { Annotation, Point, Rotation } from './types'

const size = { width: 100, height: 200 }
const apply = (m: number[], [x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

describe('toPageSpace', () => {
  // The displayed top-left corner is the page's top-left corner rotated clockwise.
  it.each<[Rotation, Point]>([
    [0, [0, 0]],
    [90, [0, 200]],
    [180, [100, 200]],
    [270, [100, 0]],
  ])('maps the displayed origin for %i°', (rotation, expected) => {
    expect(toPageSpace([0, 0], size, rotation)).toEqual(expected)
  })
})

describe('userSpaceMatrix', () => {
  const box = { x: 10, y: 20, width: 100, height: 200 }
  // Displayed top-left in y-up coordinates is (0, displayedHeight).
  it.each<[number, Point]>([
    [0, [10, 220]],
    [90, [10, 20]],
    [180, [110, 20]],
    [270, [110, 220]],
  ])('maps the displayed top-left corner for /Rotate %i', (rotate, expected) => {
    const displayedHeight = rotate % 180 ? box.width : box.height
    expect(apply(userSpaceMatrix(rotate, box), [0, displayedHeight])).toEqual(expected)
  })
})

describe('annotation geometry', () => {
  const rect: Annotation = { id: 'r', type: 'rect', color: '#f00', width: 2, x: 10, y: 10, w: 20, h: 10 }
  it('translates and resizes', () => {
    const moved = translate(rect, 5, -5)
    expect(bounds(moved, () => 0)).toEqual({ x: 15, y: 5, w: 20, h: 10 })
    const ink: Annotation = { id: 'i', type: 'ink', color: '#000', width: 1, paths: [[[0, 0], [10, 10]]] }
    const big = resize(ink, bounds(ink, () => 0), { x: 0, y: 0, w: 20, h: 40 })
    expect(big.type === 'ink' && big.paths[0][1]).toEqual([20, 40])
  })
  it('measures text boxes by line', () => {
    const text: Annotation = { id: 't', type: 'text', color: '#000', size: 10, x: 0, y: 0, text: 'ab\nabcd' }
    expect(bounds(text, (s, size) => s.length * size)).toEqual({ x: 0, y: 0, w: 40, h: 24 })
  })
  it('merges selection rects per line', () => {
    const merged = mergeLineRects([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 11, y: 1, w: 10, h: 9 },
      { x: 0, y: 20, w: 5, h: 10 },
    ])
    expect(merged).toEqual([
      { x: 0, y: 0, w: 21, h: 10 },
      { x: 0, y: 20, w: 5, h: 10 },
    ])
  })
})

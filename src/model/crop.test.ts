import { describe, expect, it } from 'vitest'
import { MIN_CROP, clampRect, cropBoxOf, displayedSize, dragCrop, intersects, normalizeCrop, rawCrop, sameCropFor, sourceRect, viewRect, visibleRect } from './crop'
import type { Rect, Rotation } from './types'

const size = { width: 100, height: 200 }
const crop: Rect = { x: 10, y: 20, w: 30, h: 40 }
const rotations: Rotation[] = [0, 90, 180, 270]

describe('clampRect and normalizeCrop', () => {
  it('pulls a rectangle into the page and keeps a minimum size', () => {
    expect(clampRect({ x: -5, y: 190, w: 50, h: 40 }, size)).toEqual({ x: 0, y: 160, w: 50, h: 40 })
    expect(clampRect({ x: 10, y: 10, w: 1, h: 500 }, size)).toEqual({ x: 10, y: 0, w: MIN_CROP, h: 200 })
  })
  it('lets a page smaller than the minimum be cropped down to its own size', () => {
    expect(clampRect({ x: 0, y: 0, w: 1, h: 1 }, { width: 10, height: 50 })).toEqual({ x: 0, y: 0, w: 10, h: MIN_CROP })
  })
  it('treats a rectangle covering the page as no crop', () => {
    expect(normalizeCrop({ x: 0.2, y: 0, w: 99.9, h: 200 }, size)).toBeUndefined()
    expect(normalizeCrop({ x: 0, y: 0, w: 99, h: 200 }, size)).toEqual({ x: 0, y: 0, w: 99, h: 200 })
    expect(normalizeCrop(null, size)).toBeUndefined()
  })
  it('ignores a rectangle that is not a number', () => {
    expect(normalizeCrop({ x: NaN, y: 0, w: 10, h: 10 }, size)).toBeUndefined()
  })
})

describe('viewRect and sourceRect', () => {
  // The crop moves with the page when it is turned: 90° turns the page clockwise.
  it.each<[Rotation, Rect]>([
    [0, { x: 10, y: 20, w: 30, h: 40 }],
    [90, { x: 140, y: 10, w: 40, h: 30 }],
    [180, { x: 60, y: 140, w: 30, h: 40 }],
    [270, { x: 20, y: 60, w: 40, h: 30 }],
  ])('puts the crop on the page turned by %i°', (rotation, expected) => {
    expect(viewRect(crop, size, rotation)).toEqual(expected)
  })
  it.each(rotations)('turns back what it turned at %i°', (rotation) => {
    expect(sourceRect(viewRect(crop, size, rotation), size, rotation)).toEqual(crop)
  })
})

describe('displayed size', () => {
  it('applies the crop first, then the rotation', () => {
    expect(displayedSize(size, { rotation: 0 })).toEqual(size)
    expect(displayedSize(size, { rotation: 90 })).toEqual({ width: 200, height: 100 })
    expect(displayedSize(size, { rotation: 0, crop })).toEqual({ width: 30, height: 40 })
    expect(displayedSize(size, { rotation: 270, crop })).toEqual({ width: 40, height: 30 })
  })
  it('places the visible part inside the turned page', () => {
    expect(visibleRect(size, { rotation: 90, crop })).toEqual({ x: 140, y: 10, w: 40, h: 30 })
    expect(visibleRect(size, { rotation: 180 })).toEqual({ x: 0, y: 0, w: 100, h: 200 })
  })
  it('shows the whole page for a crop that covers it', () => {
    expect(displayedSize(size, { rotation: 0, crop: { x: 0, y: 0, w: 100, h: 200 } })).toEqual(size)
  })
})

describe('dragCrop', () => {
  const start: Rect = { x: 20, y: 40, w: 50, h: 60 }
  const bounds = { width: 100, height: 200 }
  it('moves without leaving the page', () => {
    expect(dragCrop(start, 'move', 10, -5, bounds)).toEqual({ x: 30, y: 35, w: 50, h: 60 })
    expect(dragCrop(start, 'move', 500, 500, bounds)).toEqual({ x: 50, y: 140, w: 50, h: 60 })
    expect(dragCrop(start, 'move', -500, -500, bounds)).toEqual({ x: 0, y: 0, w: 50, h: 60 })
  })
  it('resizes from each edge and corner', () => {
    expect(dragCrop(start, 'n', 99, -10, bounds)).toEqual({ x: 20, y: 30, w: 50, h: 70 })
    expect(dragCrop(start, 's', 99, 10, bounds)).toEqual({ x: 20, y: 40, w: 50, h: 70 })
    expect(dragCrop(start, 'w', -5, 99, bounds)).toEqual({ x: 15, y: 40, w: 55, h: 60 })
    expect(dragCrop(start, 'e', 5, 99, bounds)).toEqual({ x: 20, y: 40, w: 55, h: 60 })
    expect(dragCrop(start, 'nw', 5, 5, bounds)).toEqual({ x: 25, y: 45, w: 45, h: 55 })
    expect(dragCrop(start, 'ne', 5, 5, bounds)).toEqual({ x: 20, y: 45, w: 55, h: 55 })
    expect(dragCrop(start, 'sw', 5, 5, bounds)).toEqual({ x: 25, y: 40, w: 45, h: 65 })
    expect(dragCrop(start, 'se', 5, 5, bounds)).toEqual({ x: 20, y: 40, w: 55, h: 65 })
  })
  it('stops at the page edges and at the minimum size', () => {
    expect(dragCrop(start, 'nw', -500, -500, bounds)).toEqual({ x: 0, y: 0, w: 70, h: 100 })
    expect(dragCrop(start, 'se', 500, 500, bounds)).toEqual({ x: 20, y: 40, w: 80, h: 160 })
    expect(dragCrop(start, 'e', -500, 0, bounds)).toEqual({ x: 20, y: 40, w: MIN_CROP, h: 60 })
    expect(dragCrop(start, 'n', 0, 500, bounds)).toEqual({ x: 20, y: 76, w: 50, h: MIN_CROP })
  })
})

describe('sameCropFor', () => {
  const a = { size, rotation: 0 as Rotation }
  it('gives a page of the same shape the same rectangle', () => {
    expect(sameCropFor(crop, a, a)).toEqual(crop)
  })
  it('scales it to a page of another size', () => {
    expect(sameCropFor(crop, a, { size: { width: 200, height: 400 }, rotation: 0 })).toEqual({ x: 20, y: 40, w: 60, h: 80 })
  })
  it('keeps the margins as seen on a page that is turned', () => {
    // As displayed the page is 200 x 100; the rectangle must lie in the same relative place there.
    const there = sameCropFor({ ...crop, h: 80 }, a, { size, rotation: 90 })!
    const seen = viewRect(there, size, 90)
    expect(seen.x / 200).toBeCloseTo(10 / 100)
    expect(seen.y / 100).toBeCloseTo(20 / 200)
    expect(seen.w / 200).toBeCloseTo(30 / 100)
    expect(seen.h / 100).toBeCloseTo(80 / 200)
  })
  it('leaves a page uncropped when the rectangle covers it', () => {
    expect(sameCropFor({ x: 0, y: 0, w: 100, h: 200 }, a, a)).toBeUndefined()
  })
  it('fits the rectangle to a small page', () => {
    expect(sameCropFor(crop, a, { size: { width: 60, height: 60 }, rotation: 0 })).toEqual({ x: 6, y: 6, w: MIN_CROP, h: MIN_CROP })
  })
})

describe('cropBoxOf', () => {
  const box = { x: 10, y: 20, width: 100, height: 200 }
  // The crop is given as displayed (y down, with the page's own /Rotate); the box is y up in user space.
  it.each<[number, { x: number; y: number; width: number; height: number }]>([
    [0, { x: 20, y: 160, width: 30, height: 40 }],
    [90, { x: 30, y: 30, width: 40, height: 30 }],
    [180, { x: 70, y: 40, width: 30, height: 40 }],
    [270, { x: 50, y: 180, width: 40, height: 30 }],
  ])('converts a crop on a page with /Rotate %i', (rotate, expected) => {
    expect(cropBoxOf(crop, rotate, box)).toEqual(expected)
  })
  it('gives the whole box for a crop of the whole page', () => {
    expect(cropBoxOf({ x: 0, y: 0, w: 100, h: 200 }, 0, box)).toEqual(box)
    expect(cropBoxOf({ x: 0, y: 0, w: 200, h: 100 }, 90, box)).toEqual(box)
  })
  it('keeps the crop inside the box', () => {
    expect(cropBoxOf({ x: 80, y: 180, w: 100, h: 100 }, 0, box)).toEqual({ x: 10, y: 20, width: 100, height: 100 })
  })
})

describe('form fields of a cropped page', () => {
  it('finds the crop in the unrotated frame of the page', () => {
    // Drawn 100 x 200; displayed with /Rotate 90 it is 200 x 100.
    const raw = { width: 100, height: 200 }
    expect(rawCrop(crop, raw, 0)).toEqual(crop)
    expect(rawCrop(crop, raw, 90)).toEqual({ x: 20, y: 160, w: 40, h: 30 })
  })
  it('tells overlapping rectangles from separate ones', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    expect(intersects(a, { x: 9, y: 9, w: 5, h: 5 })).toBe(true)
    expect(intersects(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false)
  })
})

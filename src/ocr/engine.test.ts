import { describe, expect, it } from 'vitest'
import { toPgm } from './engine'

describe('toPgm', () => {
  it('writes a binary grey image with the luminance of each pixel', () => {
    const rgba = Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255])
    const canvas = { width: 2, height: 2, getContext: () => ({ getImageData: () => ({ data: rgba }) }) } as unknown as HTMLCanvasElement
    const pgm = toPgm(canvas)
    const header = 'P5\n2 2\n255\n'
    expect(new TextDecoder().decode(pgm.subarray(0, header.length))).toBe(header)
    expect([...pgm.subarray(header.length)]).toEqual([255, 0, 76, 127])
  })
})

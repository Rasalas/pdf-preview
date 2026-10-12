import { describe, expect, it } from 'vitest'
import { orientPixels, orientationMatrix, readOrientation, tiffOrientation, type Orientation } from './exif'

const ORIENTATIONS: Orientation[] = [1, 2, 3, 4, 5, 6, 7, 8]

function tiff(orientation: number, { little = true, type = 3 } = {}) {
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = (n: number) => (little ? [n & 255, 0, 0, 0] : [0, 0, 0, n & 255])
  const value = type === 3 ? [...u16(orientation), 0, 0] : u32(orientation)
  return [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(type), ...u32(1), ...value, ...u32(0)]
}

const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]
const exif = (block: number[]) => segment(0xe1, [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0], block))
const jpeg = (...segments: number[][]) => Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2, 0xff, 0xd9])

describe('readOrientation', () => {
  it('reads every orientation in both byte orders', () => {
    for (const o of ORIENTATIONS) {
      expect(readOrientation(jpeg(exif(tiff(o))))).toBe(o)
      expect(readOrientation(jpeg(exif(tiff(o, { little: false }))))).toBe(o)
    }
  })

  it('accepts a LONG value and skips other segments before the EXIF block', () => {
    const xmp = segment(0xe1, [...'http://ns.adobe.com/xap/1.0/\0'].map((c) => c.charCodeAt(0)))
    expect(readOrientation(jpeg(segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), xmp, exif(tiff(6, { type: 4 }))))).toBe(6)
  })

  it('treats missing, invalid or truncated data as upright', () => {
    expect(readOrientation(jpeg())).toBe(1)
    expect(readOrientation(new Uint8Array())).toBe(1)
    expect(readOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
    expect(readOrientation(jpeg(exif(tiff(0))))).toBe(1)
    expect(readOrientation(jpeg(exif(tiff(9))))).toBe(1)
    expect(readOrientation(jpeg(exif([0x49, 0x49, 0x2b, 0])))).toBe(1)
    const whole = jpeg(exif(tiff(6)))
    for (let n = 0; n < whole.length; n += 3) expect(() => readOrientation(whole.subarray(0, n))).not.toThrow()
    // An IFD offset pointing past the data must not throw either.
    const far = tiff(6)
    far[4] = 0xf0
    expect(readOrientation(jpeg(exif(far)))).toBe(1)
  })

  it('works on a view into a larger buffer', () => {
    const bytes = jpeg(exif(tiff(8)))
    const padded = new Uint8Array(bytes.length + 5)
    padded.set(bytes, 5)
    expect(readOrientation(padded.subarray(5))).toBe(8)
  })

  it('reads a bare TIFF block, as found in PNG eXIf chunks', () => {
    expect(tiffOrientation(Uint8Array.from(tiff(3)), 0)).toBe(3)
  })
})

describe('orientationMatrix', () => {
  // Where the stored image's top-left and top-right corners land when displayed (X right, Y down, 0..1).
  const corners: Record<Orientation, [[number, number], [number, number]]> = {
    1: [[0, 0], [1, 0]],
    2: [[1, 0], [0, 0]],
    3: [[1, 1], [0, 1]],
    4: [[0, 1], [1, 1]],
    5: [[0, 0], [0, 1]],
    6: [[1, 0], [1, 1]],
    7: [[1, 1], [1, 0]],
    8: [[0, 1], [0, 0]],
  }

  it('puts the stored corners where the EXIF specification says', () => {
    const [W, H] = [300, 200]
    for (const o of ORIENTATIONS) {
      const [a, b, c, d, e, f] = orientationMatrix(o, W, H)
      // Image space has y up: top-left is (0, 1), top-right is (1, 1).
      const place = (x: number, y: number) => [(a * x + c * y + e) / W, 1 - (b * x + d * y + f) / H]
      const [topLeft, topRight] = corners[o]
      expect(place(0, 1)).toEqual(topLeft.map((n) => expect.closeTo(n, 6)))
      expect(place(1, 1)).toEqual(topRight.map((n) => expect.closeTo(n, 6)))
    }
  })

  it('is the plain scaling for upright images', () => {
    expect(orientationMatrix(1, 300, 200).map((n) => n + 0)).toEqual([300, 0, 0, 200, 0, 0])
  })

  it('keeps every corner inside the page', () => {
    for (const o of ORIENTATIONS) {
      const [a, b, c, d, e, f] = orientationMatrix(o, 300, 200)
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const px = a * x + c * y + e
        const py = b * x + d * y + f
        expect(px).toBeGreaterThanOrEqual(-1e-9)
        expect(px).toBeLessThanOrEqual(300 + 1e-9)
        expect(py).toBeGreaterThanOrEqual(-1e-9)
        expect(py).toBeLessThanOrEqual(200 + 1e-9)
      }
    }
  })
})

describe('orientPixels', () => {
  // 3 x 2 image, pixel value = index + 1.
  const stored = new Uint8Array([1, 2, 3, 4, 5, 6].flatMap((v) => [v, 0, 0, 255]))
  const rows = (o: Orientation) => {
    const { rgba, width, height } = orientPixels(stored, 3, 2, o)
    const values = Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4])
    return Array.from({ length: height }, (_, y) => values.slice(y * width, (y + 1) * width))
  }

  it('turns the stored pixels upright', () => {
    expect(rows(1)).toEqual([[1, 2, 3], [4, 5, 6]])
    expect(rows(2)).toEqual([[3, 2, 1], [6, 5, 4]])
    expect(rows(3)).toEqual([[6, 5, 4], [3, 2, 1]])
    expect(rows(4)).toEqual([[4, 5, 6], [1, 2, 3]])
    expect(rows(5)).toEqual([[1, 4], [2, 5], [3, 6]])
    expect(rows(6)).toEqual([[4, 1], [5, 2], [6, 3]])
    expect(rows(7)).toEqual([[6, 3], [5, 2], [4, 1]])
    expect(rows(8)).toEqual([[3, 6], [2, 5], [1, 4]])
  })

  it('swaps the dimensions for the rotated orientations', () => {
    expect(orientPixels(stored, 3, 2, 6)).toMatchObject({ width: 2, height: 3 })
    expect(orientPixels(stored, 3, 2, 3)).toMatchObject({ width: 3, height: 2 })
  })
})

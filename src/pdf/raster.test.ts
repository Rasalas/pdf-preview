import { describe, expect, it } from 'vitest'
import {
  classify,
  deflate,
  downscale,
  filterUp,
  inflate,
  packBilevel,
  readJpeg,
  resetOrientation,
  scaledSize,
  toGray,
  unpredict,
  type Raster,
} from './raster'

const raster = (width: number, height: number, channels: 1 | 3, fill: (i: number) => number): Raster => ({
  width,
  height,
  channels,
  data: Uint8Array.from({ length: width * height * channels }, (_, i) => fill(i)),
})

describe('classify', () => {
  it('calls photos colour, also with a grey cast', () => {
    expect(classify(raster(10, 10, 3, (i) => (i % 3 === 0 ? 200 : 80)))).toBe('color')
    expect(classify(raster(10, 10, 3, (i) => (i * 7) % 256))).toBe('color')
  })

  it('calls scans stored as RGB grey, and tolerates a few coloured pixels', () => {
    const grey = raster(100, 100, 3, (i) => (Math.floor(i / 3) * 5) % 256)
    expect(classify(grey)).toBe('gray')
    grey.data.set([255, 0, 0], 0)
    expect(classify(grey)).toBe('gray')
  })

  it('recognises black and white', () => {
    expect(classify(raster(8, 8, 1, (i) => (i % 3 ? 255 : 0)))).toBe('bilevel')
    expect(classify(raster(8, 8, 3, () => 255))).toBe('bilevel')
  })

  it('does not call two mid greys bilevel, they would flip to black and white', () => {
    expect(classify(raster(8, 8, 1, (i) => (i % 2 ? 100 : 150)))).toBe('gray')
    expect(classify(raster(8, 8, 1, () => 128))).toBe('gray')
  })
})

describe('toGray', () => {
  it('keeps neutral pixels exactly', () => {
    expect([...toGray(raster(2, 1, 3, (i) => [10, 10, 10, 255, 255, 255][i])).data]).toEqual([10, 255])
  })
})

describe('downscale', () => {
  it('averages blocks', () => {
    const src = raster(4, 2, 1, (i) => [0, 100, 20, 40, 100, 200, 60, 80][i])
    expect([...downscale(src, 2, 1).data]).toEqual([100, 50])
  })

  it('keeps channels apart', () => {
    const src = raster(2, 1, 3, (i) => [10, 20, 30, 30, 40, 50][i])
    expect([...downscale(src, 1, 1).data]).toEqual([20, 30, 40])
  })

  it('covers every pixel when sizes do not divide', () => {
    const out = downscale(raster(5, 5, 1, () => 77), 2, 2)
    expect(out).toMatchObject({ width: 2, height: 2 })
    expect([...out.data]).toEqual([77, 77, 77, 77])
  })

  it('never enlarges', () => {
    const src = raster(3, 3, 1, () => 1)
    expect(downscale(src, 9, 9)).toBe(src)
  })
})

describe('scaledSize', () => {
  it('rounds, stays at least one pixel and does not enlarge', () => {
    expect(scaledSize(1000, 333, 0.5)).toEqual({ width: 500, height: 167 })
    expect(scaledSize(10, 10, 0.001)).toEqual({ width: 1, height: 1 })
    expect(scaledSize(10, 10, 1)).toEqual({ width: 10, height: 10 })
  })
})

// The forward filters of PNG, to check unpredict against them.
function pngFilter(rows: Uint8Array[], colors: number, types: number[]): Uint8Array {
  const out: number[] = []
  rows.forEach((row, y) => {
    const prev = y > 0 ? rows[y - 1] : new Uint8Array(row.length)
    out.push(types[y])
    row.forEach((v, i) => {
      const a = i >= colors ? row[i - colors] : 0
      const b = prev[i]
      const c = i >= colors ? prev[i - colors] : 0
      const p = a + b - c
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
      const predicted = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][types[y]]
      out.push((v - predicted) & 255)
    })
  })
  return Uint8Array.from(out)
}

describe('unpredict', () => {
  const rows = Array.from({ length: 5 }, (_, y) => Uint8Array.from({ length: 12 }, (_, i) => (y * 53 + i * 29 + (i % 3) * 91) & 255))

  it('undoes every PNG filter type', () => {
    const filtered = pngFilter(rows, 3, [0, 1, 2, 3, 4])
    const out = unpredict(filtered, { predictor: 15, colors: 3, columns: 4 }, 5)
    expect(out).toEqual(Uint8Array.from(rows.flatMap((r) => [...r])))
  })

  it('undoes the TIFF predictor', () => {
    const tiff = rows.map((r) => Uint8Array.from(r, (v, i) => (v - (i >= 3 ? r[i - 3] : 0)) & 255))
    const out = unpredict(Uint8Array.from(tiff.flatMap((r) => [...r])), { predictor: 2, colors: 3, columns: 4 }, 5)
    expect(out).toEqual(Uint8Array.from(rows.flatMap((r) => [...r])))
  })

  it('refuses short data and unknown filters', () => {
    expect(unpredict(new Uint8Array(10), { predictor: 15, colors: 3, columns: 4 }, 5)).toBeNull()
    const bad = pngFilter(rows, 3, [0, 0, 0, 0, 0])
    bad[0] = 9
    expect(unpredict(bad, { predictor: 15, colors: 3, columns: 4 }, 5)).toBeNull()
  })

  it('round-trips filterUp', () => {
    const flat = Uint8Array.from(rows.flatMap((r) => [...r]))
    expect(unpredict(filterUp(flat, 12, 5), { predictor: 15, colors: 1, columns: 12 }, 5)).toEqual(flat)
  })
})

describe('packBilevel', () => {
  it('writes white as 1 and pads rows to bytes', () => {
    const gray = Uint8Array.from([255, 0, 255, 255, 255, 0, 0, 0, 0, 255])
    expect([...packBilevel(gray, 5, 2)]).toEqual([0b10111000, 0b00001000])
  })
})

describe('deflate', () => {
  it('round-trips through the zlib format PDF uses', async () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * i) & 255)
    const packed = await deflate(data)
    expect(packed[0]).toBe(0x78)
    expect(await inflate(packed)).toEqual(data)
  })
})

describe('readJpeg', () => {
  const header = (marker: number, extra: number[] = []) =>
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, ...extra, 0xff, marker, 0, 17, 8, 0x01, 0x2c, 0x02, 0x58, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])

  it('reads size and components, skipping other segments', () => {
    expect(readJpeg(header(0xc0))).toEqual({ width: 600, height: 300, components: 3, precision: 8, icc: false })
    expect(readJpeg(header(0xc2))).toMatchObject({ width: 600 })
    expect(readJpeg(header(0xc1, [0xff, 0xff]))).toMatchObject({ width: 600 })
  })

  it('rejects what browsers cannot decode and what is not a JPEG', () => {
    expect(readJpeg(header(0xc3))).toBeNull()
    expect(readJpeg(header(0xc9))).toBeNull()
    expect(readJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(readJpeg(header(0xc0).subarray(0, 14))).toBeNull()
  })
})

describe('JPEG metadata', () => {
  const frame = [0xff, 0xc0, 0, 17, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0))
  const exif = (orientation: number, little: boolean) => {
    const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255])
    const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...(little ? [8, 0, 0, 0] : [0, 0, 0, 8]), ...u16(2)]
    tiff.push(...u16(0x010f), ...u16(2), ...(little ? [1, 0, 0, 0] : [0, 0, 0, 1]), 0x41, 0, 0, 0)
    tiff.push(...u16(0x0112), ...u16(3), ...(little ? [1, 0, 0, 0] : [0, 0, 0, 1]), ...u16(orientation), 0, 0)
    return Uint8Array.from([0xff, 0xd8, ...segment(0xe1, [...text('Exif\0\0'), ...tiff]), ...frame, 0xff, 0xda])
  }

  it('turns any EXIF orientation into "upright" on a copy', () => {
    for (const little of [true, false]) {
      const original = exif(6, little)
      const upright = resetOrientation(original)
      expect(upright).not.toBe(original)
      expect(readJpeg(upright)).toMatchObject({ width: 30, height: 20 })
      expect(resetOrientation(upright)).toBe(upright)
      expect(upright).toHaveLength(original.length)
      expect(upright.filter((v, i) => v !== original[i])).toHaveLength(1)
    }
  })

  it('leaves files without orientation alone', () => {
    const plain = Uint8Array.from([0xff, 0xd8, ...frame, 0xff, 0xda])
    expect(resetOrientation(plain)).toBe(plain)
    const upright = exif(1, true)
    expect(resetOrientation(upright)).toBe(upright)
    const cut = exif(6, true).subarray(0, 30)
    expect(resetOrientation(cut)).toBe(cut)
    const notJpeg = Uint8Array.from([1, 2, 3])
    expect(resetOrientation(notJpeg)).toBe(notJpeg)
  })

  it('notices an embedded colour profile', () => {
    const profile = Uint8Array.from([0xff, 0xd8, ...segment(0xe2, [...text('ICC_PROFILE\0'), 1, 1, 0, 0]), ...frame, 0xff, 0xda])
    expect(readJpeg(profile)).toMatchObject({ icc: true })
    expect(readJpeg(Uint8Array.from([0xff, 0xd8, ...frame, 0xff, 0xda]))).toMatchObject({ icc: false })
  })
})

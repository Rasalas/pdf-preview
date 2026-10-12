import { describe, expect, it } from 'vitest'
import { encodePng, fromRgba, isPassthrough, readPng, type PngImage } from './png'

async function inflate(data: Uint8Array) {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
}

/** Minimal decoder for the PNGs we write: returns the pixel rows with the filters undone. */
async function decode(png: Uint8Array) {
  const info = readPng(png)!
  const channels = { 0: 1, 2: 3, 3: 1, 6: 4 }[info.colorType as 0 | 2 | 3 | 6]
  const bpp = Math.max(1, (channels * info.depth) >> 3)
  const rowBytes = Math.ceil((info.width * channels * info.depth) / 8)
  const raw = await inflate(info.idat)
  const out = new Uint8Array(rowBytes * info.height)
  for (let y = 0; y < info.height; y++) {
    const type = raw[y * (rowBytes + 1)]
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? out[y * rowBytes + i - bpp] : 0
      const up = y ? out[(y - 1) * rowBytes + i] : 0
      const upLeft = y && i >= bpp ? out[(y - 1) * rowBytes + i - bpp] : 0
      const p = left + up - upLeft
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft
      const predictor = [0, left, up, (left + up) >> 1, paeth][type]
      out[y * rowBytes + i] = (raw[y * (rowBytes + 1) + 1 + i] + predictor) & 255
    }
  }
  return { info, data: out }
}

function noise(length: number, seed = 1) {
  const out = new Uint8Array(length)
  let s = seed
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    out[i] = (s >> 16) & 255
  }
  return out
}

describe('encodePng', () => {
  const cases: [string, PngImage][] = [
    ['RGB', { width: 17, height: 13, depth: 8, colorType: 2, data: noise(17 * 13 * 3) }],
    ['RGBA', { width: 9, height: 7, depth: 8, colorType: 6, data: noise(9 * 7 * 4, 2) }],
    ['gray', { width: 21, height: 5, depth: 8, colorType: 0, data: noise(21 * 5, 3) }],
    ['1-bit with row padding', { width: 19, height: 6, depth: 1, colorType: 0, data: noise(3 * 6, 4) }],
    ['4-bit palette', { width: 5, height: 4, depth: 4, colorType: 3, data: noise(3 * 4, 5), palette: noise(16 * 3, 6) }],
  ]

  it.each(cases)('round-trips %s pixels', async (_, image) => {
    const { info, data } = await decode(await encodePng(image))
    expect(info).toMatchObject({ width: image.width, height: image.height, depth: image.depth, colorType: image.colorType, interlaced: false })
    expect(data).toEqual(image.data)
    if (image.palette) expect(info.palette).toEqual(image.palette)
  })

  it('compresses smooth images far below their raw size', async () => {
    const data = new Uint8Array(200 * 200 * 3).map((_, i) => ((i / 3) % 200 | 0) + (i % 3))
    const png = await encodePng({ width: 200, height: 200, depth: 8, colorType: 2, data })
    expect(png.length).toBeLessThan(data.length / 10)
  })
})

describe('fromRgba', () => {
  const px = (...pixels: number[][]) => Uint8Array.from(pixels.flatMap(([r, g, b, a = 255]) => [r, g, b, a]))

  it('packs black and white as 1 bit per pixel, most significant bit first', () => {
    const white = [255, 255, 255]
    const black = [0, 0, 0]
    // 9 pixels wide: the ninth lands in its own byte.
    const image = fromRgba(px(white, black, white, white, black, black, white, black, white), 9, 1)
    expect(image).toMatchObject({ depth: 1, colorType: 0, width: 9 })
    expect([...image.data]).toEqual([0b10110010, 0b10000000])
  })

  it('keeps gray, opaque colour and transparent pixels in their own representations', () => {
    expect(fromRgba(px([10, 10, 10], [200, 200, 200]), 2, 1)).toMatchObject({ depth: 8, colorType: 0, data: Uint8Array.from([10, 200]) })
    expect(fromRgba(px([1, 2, 3], [4, 5, 6]), 2, 1)).toMatchObject({ depth: 8, colorType: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) })
    expect(fromRgba(px([1, 2, 3, 255], [4, 5, 6, 128]), 2, 1)).toMatchObject({ depth: 8, colorType: 6 })
  })

  it('is lossless for a mixed image', async () => {
    const rgba = noise(8 * 8 * 4, 9)
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
    const { data } = await decode(await encodePng(fromRgba(rgba, 8, 8)))
    expect(data).toEqual(Uint8Array.from({ length: 8 * 8 * 3 }, (_, i) => rgba[((i / 3) | 0) * 4 + (i % 3)]))
  })
})

function ihdr(width: number, height: number, depth: number, colorType: number, interlace = 0) {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data.set([depth, colorType, 0, 0, interlace], 8)
  return data
}

function chunks(...list: [string, Uint8Array][]) {
  const parts = list.map(([type, data]) => {
    const out = new Uint8Array(12 + data.length)
    new DataView(out.buffer).setUint32(0, data.length)
    out.set([...type].map((c) => c.charCodeAt(0)), 4)
    out.set(data, 8)
    return out
  })
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...parts.flatMap((p) => [...p])])
}

describe('readPng', () => {
  it('joins split IDAT chunks and reads the header', () => {
    const png = chunks(['IHDR', ihdr(4, 2, 8, 2)], ['IDAT', Uint8Array.of(1, 2)], ['IDAT', Uint8Array.of(3)], ['IEND', new Uint8Array()])
    expect(readPng(png)).toMatchObject({ width: 4, height: 2, depth: 8, colorType: 2, transparent: false, idat: Uint8Array.of(1, 2, 3), orientation: 1 })
  })

  it('flags transparency from the colour type or a tRNS chunk', () => {
    const idat: [string, Uint8Array] = ['IDAT', Uint8Array.of(0)]
    expect(readPng(chunks(['IHDR', ihdr(1, 1, 8, 6)], idat))!.transparent).toBe(true)
    expect(readPng(chunks(['IHDR', ihdr(1, 1, 8, 3)], ['PLTE', Uint8Array.of(1, 2, 3)], ['tRNS', Uint8Array.of(0)], idat))!.transparent).toBe(true)
    expect(readPng(chunks(['IHDR', ihdr(1, 1, 8, 3)], ['PLTE', Uint8Array.of(1, 2, 3)], idat))!.transparent).toBe(false)
  })

  it('reads the orientation from an eXIf chunk', () => {
    const tiff = Uint8Array.of(0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0)
    const png = chunks(['IHDR', ihdr(1, 1, 8, 2)], ['eXIf', tiff], ['IDAT', Uint8Array.of(0)])
    expect(readPng(png)!.orientation).toBe(6)
  })

  it('rejects anything that is not a complete PNG', () => {
    expect(readPng(new Uint8Array())).toBeNull()
    expect(readPng(Uint8Array.of(0xff, 0xd8, 0xff))).toBeNull()
    expect(readPng(chunks(['IHDR', ihdr(1, 1, 8, 2)]))).toBeNull()
    const whole = chunks(['IHDR', ihdr(1, 1, 8, 2)], ['IDAT', Uint8Array.of(1, 2, 3, 4)])
    expect(readPng(whole.subarray(0, whole.length - 6))).toBeNull()
  })
})

describe('isPassthrough', () => {
  const base = { width: 1, height: 1, interlaced: false, palette: null, transparent: false, orientation: 1 as const, idat: new Uint8Array() }

  it('accepts opaque 8-bit-or-less images that are not interlaced', () => {
    expect(isPassthrough({ ...base, depth: 1, colorType: 0 })).toBe(true)
    expect(isPassthrough({ ...base, depth: 8, colorType: 0 })).toBe(true)
    expect(isPassthrough({ ...base, depth: 8, colorType: 2 })).toBe(true)
    expect(isPassthrough({ ...base, depth: 4, colorType: 3, palette: new Uint8Array(6) })).toBe(true)
  })

  it('leaves alpha, 16-bit, interlaced and palette-less images to pdf-lib', () => {
    expect(isPassthrough({ ...base, depth: 8, colorType: 6, transparent: true })).toBe(false)
    expect(isPassthrough({ ...base, depth: 16, colorType: 0 })).toBe(false)
    expect(isPassthrough({ ...base, depth: 16, colorType: 2 })).toBe(false)
    expect(isPassthrough({ ...base, depth: 8, colorType: 2, interlaced: true })).toBe(false)
    expect(isPassthrough({ ...base, depth: 8, colorType: 3 })).toBe(false)
    expect(isPassthrough({ ...base, depth: 8, colorType: 0, transparent: true })).toBe(false)
  })
})

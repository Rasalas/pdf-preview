import { describe, expect, it } from 'vitest'
import { fitPage, kindOfType, sniffImage, webpIsLossy } from './image-import'

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const bytes = (...parts: (number | number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? ascii(p) : p)))

describe('sniffImage', () => {
  it('recognises formats by content, whatever the file is called', () => {
    expect(sniffImage(bytes(0x89, 'PNG', 0x0d, 0x0a))).toBe('png')
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniffImage(bytes('GIF89a'))).toBe('gif')
    expect(sniffImage(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toBe('webp')
    expect(sniffImage(bytes('BM', 0, 0, 0, 0))).toBe('bmp')
  })

  it('tells TIFF in both byte orders and BigTIFF from other formats', () => {
    expect(sniffImage(bytes('II', 42, 0, 8, 0, 0, 0))).toBe('tiff')
    expect(sniffImage(bytes('MM', 0, 42, 0, 0, 0, 8))).toBe('tiff')
    // BigTIFF is routed to the TIFF reader, which explains that it is not supported.
    expect(sniffImage(bytes('II', 43, 0, 8, 0))).toBe('tiff')
    expect(sniffImage(bytes('II', 41, 0))).toBeNull()
  })

  it('tells HEIC from AVIF by the brand of the ftyp box', () => {
    const ftyp = (brand: string) => bytes(0, 0, 0, 24, 'ftyp', brand, 0, 0, 0, 0)
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'heif']) expect(sniffImage(ftyp(brand))).toBe('heic')
    for (const brand of ['avif', 'avis']) expect(sniffImage(ftyp(brand))).toBe('avif')
    expect(sniffImage(ftyp('isom'))).toBeNull()
  })

  it('finds SVG after an XML declaration, a comment or a BOM, but not in other text', () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg')
    expect(sniffImage(bytes('﻿'.length ? [0xef, 0xbb, 0xbf] : [], '<?xml version="1.0"?>\n<!-- c -->\n<svg width="1"/>'))).toBe('svg')
    expect(sniffImage(bytes('hello world'))).toBeNull()
    expect(sniffImage(bytes('<svgx>'))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
  })
})

describe('kindOfType', () => {
  it('maps MIME types, including the odd spellings systems use', () => {
    expect(kindOfType('image/png')).toBe('png')
    expect(kindOfType('image/jpeg')).toBe('jpeg')
    expect(kindOfType('image/x-ms-bmp')).toBe('bmp')
    expect(kindOfType('image/svg+xml')).toBe('svg')
    expect(kindOfType('image/tiff')).toBe('tiff')
    expect(kindOfType('image/heif')).toBe('heic')
    expect(kindOfType('image/heic-sequence')).toBe('heic')
    expect(kindOfType('image/x-icon')).toBeNull()
    expect(kindOfType('')).toBeNull()
  })
})

describe('webpIsLossy', () => {
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]
  const webp = (...chunks: [string, number[]][]) => bytes('RIFF', u32(0), 'WEBP', chunks.flatMap(([id, data]) => [ascii(id), u32(data.length), data, data.length % 2 ? [0] : []]).flat())

  it('is true for a VP8 image and false for VP8L', () => {
    expect(webpIsLossy(webp(['VP8 ', [1, 2, 3, 4]]))).toBe(true)
    expect(webpIsLossy(webp(['VP8L', [1, 2, 3, 4]]))).toBe(false)
  })

  it('walks past the extended header and an alpha chunk, odd sizes included', () => {
    expect(webpIsLossy(webp(['VP8X', Array(10).fill(0)], ['ALPH', [1, 2, 3]], ['VP8 ', [1, 2]]))).toBe(true)
    expect(webpIsLossy(webp(['VP8X', Array(10).fill(0)], ['VP8L', [1, 2]]))).toBe(false)
  })

  it('treats files without an image chunk as lossless, which is the safe choice', () => {
    expect(webpIsLossy(webp(['ANIM', [0, 0, 0, 0, 0, 0]]))).toBe(false)
    expect(webpIsLossy(new Uint8Array())).toBe(false)
  })
})

describe('fitPage', () => {
  it('uses 96 dpi for small images', () => {
    expect(fitPage(400, 200)).toEqual({ width: 300, height: 150 })
  })

  it('shrinks large images so that the long edge is A4', () => {
    const page = fitPage(12000, 9000)
    expect(page.width).toBeCloseTo(842, 6)
    expect(page.height).toBeCloseTo(631.5, 6)
    expect(fitPage(3000, 4000).height).toBeCloseTo(842, 6)
  })
})

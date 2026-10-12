import { describe, expect, it } from 'vitest'
import { TiffError, pageIfds, physicalSize, tiffPages, type TiffPage } from './tiff'
import type { PngImage } from './png'

// Small files written with Pillow, one per compression we have to read.
const G4 = 'SUkqABYAAAAzDH///k1BR///4AIAIAwAAAEDAAEAAAAYAAAAAQEDAAEAAAAQAAAAAgEDAAEAAAABAAAAAwEDAAEAAAAEAAAABgEDAAEAAAABAAAAEQEEAAEAAAAIAAAAFgEDAAEAAAAQAAAAFwEEAAEAAAAOAAAAGgEFAAEAAACsAAAAGwEFAAEAAAC0AAAAHAEDAAEAAAABAAAAKAEDAAEAAAACAAAAAAAAACwBAAABAAAALAEAAAEAAAA='
const G3 = 'SUkqAE4AAAAAGYYHABmGBwAZhgcAGYYHABmGBwAZhgcAGYYHABmGBwATUFA4AJqCgcAE1BQOACagoHABNQUDgAmoKBwATUFA4AJqCgcADAAAAQMAAQAAABgAAAABAQMAAQAAABAAAAACAQMAAQAAAAEAAAADAQMAAQAAAAMAAAAGAQMAAQAAAAEAAAARAQQAAQAAAAgAAAAWAQMAAQAAABAAAAAXAQQAAQAAAEUAAAAaAQUAAQAAAOQAAAAbAQUAAQAAAOwAAAAcAQMAAQAAAAEAAAAoAQMAAQAAAAIAAAAAAAAALAEAAAEAAAAsAQAAAQAAAA=='
const LZW_BILEVEL = 'SUkqACIAAACAAB/v6BQSBwWEQeFP5/wOGwyHRGIROHwEAAwAAAEDAAEAAAAYAAAAAQEDAAEAAAAQAAAAAgEDAAEAAAABAAAAAwEDAAEAAAAFAAAABgEDAAEAAAABAAAAEQEEAAEAAAAIAAAAFgEDAAEAAAAQAAAAFwEEAAEAAAAZAAAAGgEFAAEAAAC4AAAAGwEFAAEAAADAAAAAHAEDAAEAAAABAAAAKAEDAAEAAAACAAAAAAAAACwBAAABAAAALAEAAAEAAAA='
// Two RGB pages, 8 x 6, LZW, 100 x 50 dpi: red with one blue pixel at the top left, then green.
const RGB2 = 'SUkqAC4AAACAAAAP9kBQKQWDwaEQuFQ2Ew+GRCHRGKROLRKMRWMxeNR2OQ6AgA0AAAEDAAEAAAAIAAAAAQEDAAEAAAAGAAAAAgEDAAMAAADgAAAAAwEDAAEAAAAFAAAABgEDAAEAAAACAAAAEQEEAAEAAAAIAAAAFQEDAAEAAAADAAAAFgEDAAEAAAAGAAAAFwEEAAEAAAAmAAAAGgEFAAEAAADQAAAAGwEFAAEAAADYAAAAHAEDAAEAAAABAAAAKAEDAAEAAAACAAAAGgEAAGQAAAABAAAAMgAAAAEAAAAIAAgACAAAAAAAAAAAAAAASUkqACoAAACABRkBSBQSBwWEQeFQaGQmGwuHRGIROHxWJRaKReNRmKQEDQAAAQMAAQAAAAgAAAABAQMAAQAAAAYAAAACAQMAAwAAAMwBAAADAQMAAQAAAAUAAAAGAQMAAQAAAAIAAAARAQQAAQAAAPgAAAAVAQMAAQAAAAMAAAAWAQMAAQAAAAYAAAAXAQQAAQAAACIAAAAaAQUAAQAAALwBAAAbAQUAAQAAAMQBAAAcAQMAAQAAAAEAAAAoAQMAAQAAAAIAAAAAAAAAZAAAAAEAAAAyAAAAAQAAAAgACAAIAAAAAAAAAAAAAAAAAAAA'

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

type Entry = [tag: number, type: 3 | 4 | 5, values: number[]]
interface FilePage {
  width: number
  height: number
  entries?: Entry[]
  data: number[]
}

/** Writes an uncompressed little-endian TIFF with the given tags. */
function tiffFile(pages: FilePage[]): Uint8Array {
  const out: number[] = []
  const u16 = (n: number) => [n & 255, (n >> 8) & 255]
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
  out.push(0x49, 0x49, 42, 0, ...u32(8))
  pages.forEach((page, index) => {
    const entries: Entry[] = [
      [256, 4, [page.width]],
      [257, 4, [page.height]],
      [259, 3, [1]],
      [278, 4, [page.height]],
      [279, 4, [page.data.length]],
      ...(page.entries ?? []),
    ]
    const sized = (e: Entry) => (e[1] === 3 ? 2 : 4) * e[2].length
    const ifdStart = out.length
    const ifdSize = 2 + 12 * (entries.length + 1) + 4
    let overflow = ifdStart + ifdSize
    const extra: number[] = []
    const stripAt = overflow + entries.filter((e) => sized(e) > 4).reduce((n, e) => n + sized(e), 0)
    const all: Entry[] = [...entries, [273, 4, [stripAt]] as Entry].sort((a, b) => a[0] - b[0])
    const body: number[] = [...u16(all.length)]
    for (const [tag, type, values] of all) {
      const encoded = values.flatMap((v) => (type === 3 ? u16(v) : u32(v)))
      body.push(...u16(tag), ...u16(type), ...u32(type === 5 ? values.length / 2 : values.length))
      if (encoded.length <= 4) body.push(...encoded, ...Array(4 - encoded.length).fill(0))
      else {
        body.push(...u32(overflow))
        extra.push(...encoded)
        overflow += encoded.length
      }
    }
    const padded = page.data.length + (page.data.length % 2)
    body.push(...u32(index === pages.length - 1 ? 0 : stripAt + padded))
    out.push(...body, ...extra, ...page.data, ...Array(padded - page.data.length).fill(0))
  })
  return Uint8Array.from(out)
}

async function pagesOf(bytes: Uint8Array): Promise<TiffPage[]> {
  const pages: TiffPage[] = []
  for await (const page of tiffPages(bytes)) pages.push(page)
  return pages
}

const asPng = (page: TiffPage) => page.image as PngImage

describe('tiffPages: compressions', () => {
  // 24 x 16, black square of 8 x 8 at the top left and a black column at the right edge.
  function expectBilevelSquare(page: TiffPage) {
    const image = asPng(page)
    expect(image).toMatchObject({ width: 24, height: 16, depth: 1, colorType: 0 })
    // Rows are 3 bytes. PNG gray: 0 is black.
    expect([...image.data.subarray(0, 3)]).toEqual([0b00000000, 0xff, 0b11111110])
    expect([...image.data.subarray(8 * 3, 8 * 3 + 3)]).toEqual([0xff, 0xff, 0b11111110])
  }

  it.each([
    ['CCITT group 4', G4],
    ['CCITT group 3', G3],
    ['LZW', LZW_BILEVEL],
  ])('reads %s bilevel scans without expanding them', async (_, data) => {
    const pages = await pagesOf(bytesOf(data))
    expect(pages).toHaveLength(1)
    expectBilevelSquare(pages[0])
  })

  it('takes the physical size from the resolution tags', async () => {
    const [page] = await pagesOf(bytesOf(G4))
    // 24 x 16 px at 300 dpi.
    expect(page.size!.width).toBeCloseTo(5.76, 2)
    expect(page.size!.height).toBeCloseTo(3.84, 2)
  })

  it('reads every page of a multi-page file in order, with its own resolution per axis', async () => {
    const pages = await pagesOf(bytesOf(RGB2))
    expect(pages).toHaveLength(2)
    const [first, second] = pages.map(asPng)
    expect(first).toMatchObject({ width: 8, height: 6, depth: 8, colorType: 2 })
    expect([...first.data.subarray(0, 6)]).toEqual([0, 0, 255, 200, 20, 20])
    expect([...second.data.subarray(0, 3)]).toEqual([20, 200, 20])
    // 8 px at 100 dpi, 6 px at 50 dpi.
    expect(pages[0].size!.width).toBeCloseTo(5.76, 2)
    expect(pages[0].size!.height).toBeCloseTo(8.64, 2)
  })

  it('refuses garbage with a message instead of an empty page', async () => {
    await expect(pagesOf(new TextEncoder().encode('hello world, this is no TIFF at all'))).rejects.toBeInstanceOf(TiffError)
    const truncated = bytesOf(RGB2).subarray(0, 60)
    await expect(pagesOf(truncated)).rejects.toBeInstanceOf(TiffError)
  })
})

describe('tiffPages: pixel layouts', () => {
  it('flips WhiteIsZero gray into PNG gray', async () => {
    const file = tiffFile([{ width: 3, height: 1, entries: [[258, 3, [8]], [262, 3, [0]]], data: [0, 100, 255] }])
    const [page] = await pagesOf(file)
    expect(asPng(page)).toMatchObject({ depth: 8, colorType: 0, data: Uint8Array.from([255, 155, 0]) })
  })

  it('keeps BlackIsZero 4-bit gray as it is', async () => {
    const file = tiffFile([{ width: 3, height: 2, entries: [[258, 3, [4]], [262, 3, [1]]], data: [0x01, 0x20, 0x34, 0x50] }])
    const [page] = await pagesOf(file)
    expect(asPng(page)).toMatchObject({ depth: 4, colorType: 0, data: Uint8Array.from([0x01, 0x20, 0x34, 0x50]) })
  })

  it('turns a colour map into a PNG palette', async () => {
    const map = [...Array(16)].map((_, i) => i * 256)
    // 16 reds, then greens, then blues, 16-bit each: entry i is (i, 15 - i, 0) * 256.
    const colormap = [...map, ...map.map((v) => 15 * 256 - v), ...Array(16).fill(0)]
    const file = tiffFile([{ width: 2, height: 1, entries: [[258, 3, [4]], [262, 3, [3]], [320, 3, colormap]], data: [0x0f] }])
    const [page] = await pagesOf(file)
    const image = asPng(page)
    expect(image).toMatchObject({ depth: 4, colorType: 3 })
    expect([...image.palette!.subarray(0, 6)]).toEqual([0, 15, 0, 1, 14, 0])
    expect([...image.palette!.subarray(15 * 3, 16 * 3)]).toEqual([15, 0, 0])
  })

  it('reads 16-bit gray as 8-bit gray', async () => {
    const file = tiffFile([{ width: 2, height: 1, entries: [[258, 3, [16]], [262, 3, [1]]], data: [0x00, 0x00, 0x00, 0x80] }])
    const [page] = await pagesOf(file)
    expect(asPng(page)).toMatchObject({ depth: 8, colorType: 0, data: Uint8Array.from([0, 128]) })
  })

  it('keeps alpha', async () => {
    const file = tiffFile([{ width: 1, height: 1, entries: [[258, 3, [8, 8, 8, 8]], [262, 3, [2]], [277, 3, [4]], [338, 3, [2]]], data: [10, 20, 30, 128] }])
    const [page] = await pagesOf(file)
    expect(asPng(page)).toMatchObject({ depth: 8, colorType: 6, data: Uint8Array.from([10, 20, 30, 128]) })
  })

  it('applies the orientation tag and swaps width, height and resolution', async () => {
    // Stored 3 x 2, orientation 6 (rotate clockwise): displayed 2 x 3.
    const entries: Entry[] = [[258, 3, [8]], [262, 3, [1]], [274, 3, [6]], [282, 5, [300, 1]], [283, 5, [100, 1]], [296, 3, [2]]]
    const [page] = await pagesOf(tiffFile([{ width: 3, height: 2, entries, data: [1, 2, 3, 4, 5, 6] }]))
    expect(page).toMatchObject({ width: 2, height: 3 })
    const image = asPng(page)
    expect(image).toMatchObject({ width: 2, height: 3, colorType: 0 })
    expect([...image.data]).toEqual([4, 1, 5, 2, 6, 3])
    // 3 px at 300 dpi by 2 px at 100 dpi; turning puts the 2 px side first.
    expect(page.size!.width).toBeCloseTo((2 / 100) * 72, 5)
    expect(page.size!.height).toBeCloseTo((3 / 300) * 72, 5)
  })

  it('refuses pages that would not fit in memory before decoding them', async () => {
    const huge = tiffFile([{ width: 20000, height: 20000, entries: [[258, 3, [8, 8, 8]], [262, 3, [2]], [277, 3, [3]]], data: [0] }])
    await expect(pagesOf(huge)).rejects.toThrow(/zu groß/)
  })

  it('refuses compressions and colour models it cannot decode', async () => {
    const jp2 = tiffFile([{ width: 1, height: 1, entries: [[258, 3, [8]], [262, 3, [1]]], data: [0] }])
    // Overwrite the compression tag value (259) in place.
    const view = new DataView(jp2.buffer)
    for (let pos = 10; pos < 10 + 12 * 8; pos += 12) if (view.getUint16(pos, true) === 259) view.setUint16(pos + 8, 34712, true)
    await expect(pagesOf(jp2)).rejects.toThrow(/Kompression/)
    const lab = tiffFile([{ width: 1, height: 1, entries: [[258, 3, [8]], [262, 3, [8]]], data: [0] }])
    await expect(pagesOf(lab)).rejects.toThrow(/Farbdarstellung/)
  })
})

describe('pageIfds', () => {
  const ifd = (t254?: number[]) => ({ width: 1, height: 1, data: new Uint8Array(), ...(t254 ? { t254 } : {}) })

  it('skips reduced-resolution copies and masks', () => {
    const [full, thumb, mask, page2] = [ifd(), ifd([1]), ifd([4]), ifd([2])]
    expect(pageIfds([full, thumb, mask, page2])).toEqual([full, page2])
  })

  it('keeps everything when nothing else is left', () => {
    const only = [ifd([1])]
    expect(pageIfds(only)).toEqual(only)
  })
})

describe('physicalSize', () => {
  it('turns a 300 dpi A4 scan into A4', () => {
    const size = physicalSize(2480, 3508, 300, 300, 2)!
    expect(size.width).toBeCloseTo(595.2, 1)
    expect(size.height).toBeCloseTo(841.9, 1)
  })

  it('handles different resolutions per axis, like fax pages', () => {
    const size = physicalSize(1728, 1100, 204, 98, 2)!
    expect(size.width).toBeCloseTo(609.9, 1)
    expect(size.height).toBeCloseTo(808.2, 1)
  })

  it('reads centimetres and defaults to inches', () => {
    expect(physicalSize(1000, 500, 100, 100, 3)!.width).toBeCloseTo((1000 / 254) * 72, 5)
    expect(physicalSize(1000, 500, 100, 100, undefined)!.width).toBeCloseTo(720, 5)
  })

  it('uses the one resolution that is given for both axes', () => {
    expect(physicalSize(720, 360, 72, undefined, 2)).toEqual({ width: 720, height: 360 })
  })

  it('falls back when the tags say nothing usable', () => {
    expect(physicalSize(100, 100, undefined, undefined, 2)).toBeNull()
    expect(physicalSize(100, 100, 300, 300, 1)).toBeNull()
    expect(physicalSize(100, 100, 0, 0, 2)).toBeNull()
    expect(physicalSize(100, 100, 1, 1, 2)).toBeNull()
    expect(physicalSize(100, 100, NaN, 300, 2)).toBeNull()
  })

  it('shrinks pages larger than A3 and keeps their proportions', () => {
    const size = physicalSize(7200, 3600, 72, 72, 2)!
    expect(size.width).toBeCloseTo(1191, 5)
    expect(size.height).toBeCloseTo(595.5, 5)
  })
})

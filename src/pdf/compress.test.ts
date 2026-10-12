import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, StandardFonts, type PDFObject } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { Page, Source } from '../model/types'
import type { Codec } from './codec'
import { collectImages, compressImages, formatSize, isCompact, matchesJpeg, planImage, savingsMessage, scaleFor, subProgress, worthReplacing, type Plan } from './compress'
import { deflate, inflate, packBilevel, unpredict, type Raster } from './raster'

// buildPdf uses the browser codec; in Node a stand-in stays small and counts as JPEG.
const fake = vi.hoisted(() => ({ jpegSize: (r: { width: number; height: number }) => Math.ceil((r.width * r.height) / 20) }))
vi.mock('./codec', () => ({
  browserCodec: { openJpeg: () => Promise.reject(new Error('no canvas')), encodeJpeg: async (r: Raster) => new Uint8Array(fake.jpegSize(r)) },
}))
const { buildPdf } = await import('./export')

// Decoding and deflating megabytes of pixels is slow on busy CI machines.
vi.setConfig({ testTimeout: 30_000 })

const A4 = { width: 595.28, height: 841.89 }

describe('scaleFor', () => {
  it('brings a 300 dpi scan down to 150 dpi', () => {
    expect(scaleFor(2480, 3508, [A4])).toBeCloseTo(0.5, 2)
  })

  it('leaves images below 225 dpi alone', () => {
    expect(scaleFor(1654, 2339, [A4])).toBe(1)
    expect(scaleFor(300, 200, [A4])).toBe(1)
  })

  it('does not care how the image is turned relative to the page', () => {
    expect(scaleFor(3508, 2480, [A4])).toBeCloseTo(0.5, 2)
  })

  it('judges an image larger than the page by the page, wherever it is placed', () => {
    expect(scaleFor(6000, 300, [A4])).toBeCloseTo(0.292, 2)
    expect(scaleFor(300, 6000, [A4])).toBeCloseTo(0.292, 2)
  })

  it('serves the biggest page when several show the image', () => {
    const a5 = { width: A4.width / 2, height: A4.height / 2 }
    expect(scaleFor(2480, 3508, [a5, A4])).toBeCloseTo(0.5, 2)
    expect(scaleFor(2480, 3508, [a5])).toBeCloseTo(0.25, 2)
  })

  it('is neutral without a page', () => {
    expect(scaleFor(5000, 5000, [])).toBe(1)
  })
})

describe('worthReplacing', () => {
  it('wants a real gain, more when a JPEG is compressed again at the same size', () => {
    expect(worthReplacing(1000, 899, false)).toBe(true)
    expect(worthReplacing(1000, 950, false)).toBe(false)
    expect(worthReplacing(1000, 800, true)).toBe(false)
    expect(worthReplacing(1000, 740, true)).toBe(true)
    expect(worthReplacing(1000, 1200, false)).toBe(false)
  })

  it('treats low bit rates as compact', () => {
    expect(isCompact(100_000, 1_000_000)).toBe(true)
    expect(isCompact(300_000, 1_000_000)).toBe(false)
  })
})

describe('formatting', () => {
  it('uses German number formats', () => {
    expect(formatSize(2_412_345)).toBe('2,4 MB')
    expect(formatSize(18_400)).toBe('18 KB')
    expect(formatSize(640)).toBe('640 Byte')
  })

  it('names both sizes when something got smaller', () => {
    expect(savingsMessage(2_400_000, { images: 3, replaced: 2, saved: 15_700_000 })).toBe('Gesichert: 2,4 MB statt 18,1 MB')
  })

  it('says so when nothing could be reduced', () => {
    expect(savingsMessage(900_000, { images: 0, replaced: 0, saved: 0 })).toBe(
      'Gesichert: 900 KB. Das Dokument enthält keine Bilder, die sich verkleinern ließen.',
    )
    expect(savingsMessage(900_000, { images: 2, replaced: 0, saved: 0 })).toBe('Gesichert: 900 KB. Die Bilder ließen sich nicht weiter verkleinern.')
    expect(savingsMessage(900_000, { images: 2, replaced: 1, saved: 3_000 })).toContain('nicht weiter')
  })

  it('maps progress onto a part of the bar', () => {
    const seen: number[][] = []
    subProgress((d, t) => seen.push([d, t]), 0.1, 1)!(1, 2)
    expect(seen).toEqual([[550, 1000]])
    expect(subProgress(undefined, 0, 1)).toBeUndefined()
  })
})

type Literal = Record<string, unknown>

/** An image stream with the given dictionary entries; enough bytes to pass the size floor. */
async function setup(dict: Literal, contents: Uint8Array = new Uint8Array(20_000)) {
  const doc = await PDFDocument.create()
  const stream = doc.context.stream(contents, { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, ...dict } as never)
  return { doc, dict: stream.dict, stream, ref: doc.context.register(stream) }
}

const names = (...n: string[]) => n
function icc(doc: PDFDocument, n: number) {
  return doc.context.obj(['ICCBased', doc.context.register(doc.context.stream(new Uint8Array(8), { N: n }))] as never)
}

function jpegBytes(width: number, height: number, components = 3, size = 20_000): Uint8Array {
  const out = new Uint8Array(size)
  const frame = [0xff, 0xc0, 0, 8 + components * 3, 8, height >> 8, height & 255, width >> 8, width & 255, components]
  for (let c = 1; c <= components; c++) frame.push(c, 0x11, 0)
  out.set([0xff, 0xd8, ...frame, 0xff, 0xda])
  return out
}

describe('planImage', () => {
  it('accepts 8 bit RGB and grey in Flate and DCT', async () => {
    const flate = await setup({ Filter: 'FlateDecode' })
    expect(planImage(flate.dict)).toMatchObject({ filter: 'flate', channels: 3, width: 100, height: 100 })
    const grey = await setup({ Filter: 'FlateDecode', ColorSpace: 'DeviceGray' })
    expect(planImage(grey.dict)).toMatchObject({ filter: 'flate', channels: 1 })
    const dct = await setup({ Filter: names('DCTDecode') }, jpegBytes(100, 100))
    expect(planImage(dct.dict)).toMatchObject({ filter: 'dct', channels: 3 })
  })

  it('reads ICC based and calibrated spaces by their component count', async () => {
    const rgb = await setup({ Filter: 'FlateDecode' })
    rgb.dict.set(PDFName.of('ColorSpace'), icc(rgb.doc, 3))
    expect(planImage(rgb.dict)).toMatchObject({ channels: 3 })
    const gray = await setup({ Filter: 'FlateDecode' })
    gray.dict.set(PDFName.of('ColorSpace'), icc(gray.doc, 1))
    expect(planImage(gray.dict)).toMatchObject({ channels: 1 })
    const cmyk = await setup({ Filter: 'FlateDecode' })
    cmyk.dict.set(PDFName.of('ColorSpace'), icc(cmyk.doc, 4))
    expect(planImage(cmyk.dict)).toBe('color')
    const cal = await setup({ Filter: 'FlateDecode', ColorSpace: ['CalRGB', {}] })
    expect(planImage(cal.dict)).toMatchObject({ channels: 3 })
  })

  it.each([
    ['CMYK', { ColorSpace: 'DeviceCMYK', Filter: 'FlateDecode' }, 'color'],
    ['Indexed', { ColorSpace: ['Indexed', 'DeviceRGB', 1, '<000000ffffff>'], Filter: 'FlateDecode' }, 'color'],
    ['Lab', { ColorSpace: ['Lab', {}], Filter: 'FlateDecode' }, 'color'],
    ['16 bit', { BitsPerComponent: 16, Filter: 'FlateDecode' }, 'depth'],
    ['1 bit', { BitsPerComponent: 1, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' }, 'depth'],
    ['inverted Decode', { Decode: [1, 0, 1, 0, 1, 0], Filter: 'FlateDecode' }, 'decode'],
    ['stencil mask', { ImageMask: true, Filter: 'FlateDecode' }, 'mask'],
    ['colour key mask', { Mask: [0, 10, 0, 10, 0, 10], Filter: 'FlateDecode' }, 'mask'],
    ['premultiplied soft mask', { Filter: 'FlateDecode' }, 'mask'],
    ['CCITT', { ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode' }, 'filter'],
    ['JBIG2', { ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'JBIG2Decode' }, 'filter'],
    ['JPX', { Filter: 'JPXDecode' }, 'filter'],
    ['LZW', { Filter: 'LZWDecode' }, 'filter'],
    ['predictor for other colours', { Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: 1, Columns: 100 } }, 'params'],
    ['predictor for other width', { Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: 3, Columns: 99 } }, 'params'],
    ['unknown predictor', { Filter: 'FlateDecode', DecodeParms: { Predictor: 7 } }, 'params'],
  ])('skips %s', async (label, entries, reason) => {
    const { doc, dict } = await setup(entries as Literal)
    if (label === 'premultiplied soft mask') {
      const mask = doc.context.stream(new Uint8Array(4), { Matte: [0, 0, 0] } as never)
      dict.set(PDFName.of('SMask'), doc.context.register(mask))
    }
    expect(planImage(dict)).toBe(reason)
  })

  it('keeps images with a soft mask, even of another size', async () => {
    const { doc, dict } = await setup({ Filter: 'FlateDecode' })
    const mask = doc.context.stream(new Uint8Array(4), { Type: 'XObject', Subtype: 'Image', Width: 400, Height: 400, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never)
    dict.set(PDFName.of('SMask'), doc.context.register(mask))
    expect(planImage(dict)).toMatchObject({ filter: 'flate' })
  })

  it('understands predictors with the right parameters', async () => {
    const { dict } = await setup({ Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: 3, Columns: 100, BitsPerComponent: 8 } })
    expect(planImage(dict)).toMatchObject({ predictor: { predictor: 15, colors: 3, columns: 100 } })
    const array = await setup({ Filter: ['FlateDecode'], DecodeParms: [{ Predictor: 2, Colors: 3, Columns: 100 }] })
    expect(planImage(array.dict)).toMatchObject({ predictor: { predictor: 2 } })
  })

  it('sees through transport encodings like ASCII85 around the codec', async () => {
    const a85 = await setup({ Filter: names('ASCII85Decode', 'FlateDecode') })
    expect(planImage(a85.dict)).toMatchObject({ filter: 'flate', transport: [PDFName.of('ASCII85Decode')] })
    const withParms = await setup({ Filter: names('ASCIIHexDecode', 'FlateDecode'), DecodeParms: [null, { Predictor: 15, Colors: 3, Columns: 100 }] })
    expect(planImage(withParms.dict)).toMatchObject({ transport: [PDFName.of('ASCIIHexDecode')], predictor: { predictor: 15 } })
    const dct = await setup({ Filter: names('ASCII85Decode', 'DCTDecode') })
    expect(planImage(dct.dict)).toMatchObject({ filter: 'dct', transport: [PDFName.of('ASCII85Decode')] })
  })

  it('skips chains it cannot undo', async () => {
    for (const chain of [names('FlateDecode', 'DCTDecode'), names('LZWDecode', 'FlateDecode'), names('ASCII85Decode', 'CCITTFaxDecode'), []]) {
      const { dict } = await setup({ Filter: chain })
      expect(planImage(dict)).toBe('filter')
    }
    const lone = await setup({ Filter: names('ASCII85Decode', 'FlateDecode'), DecodeParms: { Predictor: 15, Colors: 3, Columns: 100 } })
    expect(planImage(lone.dict)).toBe('filter')
  })

  it('rejects params that change the colours', async () => {
    const { dict } = await setup({ Filter: 'DCTDecode', DecodeParms: { ColorTransform: 0 } })
    expect(planImage(dict)).toBe('params')
  })
})

describe('matchesJpeg', () => {
  const plan: Plan = { filter: 'dct', transport: [], device: true, channels: 3, width: 100, height: 100 }

  it('wants the size, component count and depth of the dictionary', () => {
    expect(matchesJpeg(jpegBytes(100, 100), plan)).toBe(true)
    expect(matchesJpeg(jpegBytes(100, 99), plan)).toBe(false)
    expect(matchesJpeg(jpegBytes(100, 100, 4), plan)).toBe(false)
    expect(matchesJpeg(jpegBytes(100, 100, 1), plan)).toBe(false)
    expect(matchesJpeg(new Uint8Array(100), plan)).toBe(false)
  })

  it('refuses a JPEG with its own profile under a profile of the PDF, which would be applied twice', () => {
    const withProfile = jpegBytes(100, 100)
    const profile = [0xff, 0xe2, 0, 18, ...[...'ICC_PROFILE\0'].map((c) => c.charCodeAt(0)), 1, 1, 0, 0]
    withProfile.copyWithin(2 + profile.length, 2)
    withProfile.set(profile, 2)
    expect(matchesJpeg(withProfile, plan)).toBe(true)
    expect(matchesJpeg(withProfile, { ...plan, device: false })).toBe(false)
    expect(matchesJpeg(jpegBytes(100, 100), { ...plan, device: false })).toBe(true)
  })
})

describe('collectImages', () => {
  it('finds images on pages and inside forms, once per image, with every page size', async () => {
    const doc = await PDFDocument.create()
    const image = doc.context.register(doc.context.stream(new Uint8Array(10), { Subtype: 'Image', Width: 1, Height: 1 } as never))
    const inForm = doc.context.register(doc.context.stream(new Uint8Array(10), { Subtype: 'Image', Width: 1, Height: 1 } as never))
    const form = doc.context.register(doc.context.formXObject([], { Resources: { XObject: { Deep: inForm } } } as never))
    const small = doc.addPage([100, 200])
    const big = doc.addPage([300, 400])
    const same = doc.addPage([100, 200])
    for (const page of [small, big, same]) page.node.newXObject('Im', image)
    big.node.newXObject('Fm', form)
    // A form that shows itself must not loop.
    const loop = doc.context.formXObject([], { Resources: { XObject: {} } } as never)
    const loopRef = doc.context.register(loop)
    ;(loop.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict) as PDFDict).set(PDFName.of('Self'), loopRef)
    small.node.newXObject('Loop', loopRef)

    const jobs = collectImages(doc.getPages())
    expect(jobs).toHaveLength(2)
    expect(jobs.find((j) => j.ref === image)!.pages).toEqual([
      { width: 100, height: 200 },
      { width: 300, height: 400 },
    ])
    expect(jobs.find((j) => j.ref === inForm)!.pages).toEqual([{ width: 300, height: 400 }])
  })

  it('ignores masks that no page shows and streams that are not images', async () => {
    const doc = await PDFDocument.create()
    const mask = doc.context.register(doc.context.stream(new Uint8Array(10), { Subtype: 'Image', Width: 1, Height: 1 } as never))
    const image = doc.context.register(doc.context.stream(new Uint8Array(10), { Subtype: 'Image', SMask: mask, Width: 1, Height: 1 } as never))
    const page = doc.addPage([100, 100])
    page.node.newXObject('Im', image)
    expect(collectImages([page]).map((j) => j.ref)).toEqual([image])
  })
})

/** A gradient with noise, so that it does not deflate to nothing like a synthetic pattern. */
function gradient(width: number, height: number, channels: 1 | 3): Uint8Array {
  const data = new Uint8Array(width * height * channels)
  let seed = 12345
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[i] = (((i / channels) % width) / 4 + ((i / channels / width) | 0) / 3 + (seed >> 16) % 48) & 255
  }
  return data
}

/** Black rectangles on white: what a scanned page looks like to a compressor. */
function textPage(width: number, height: number): Uint8Array {
  return Uint8Array.from({ length: width * height }, (_, i) => {
    const x = i % width
    const y = (i / width) | 0
    return (x % 40 < 3 || y % 50 === 0 || (x * y) % 97 === 0) ? 0 : 255
  })
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const v of bytes) {
    a = (a + v) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** Zlib "stored" blocks, no compression: how a careless producer might have saved it. */
function stored(bytes: Uint8Array): Uint8Array {
  const blocks = Math.ceil(bytes.length / 65535)
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4)
  out.set([0x78, 0x01])
  let at = 2
  for (let i = 0; i < bytes.length; i += 65535) {
    const n = Math.min(65535, bytes.length - i)
    out.set([i + n >= bytes.length ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255], at)
    out.set(bytes.subarray(i, i + n), at + 5)
    at += 5 + n
  }
  new DataView(out.buffer).setUint32(at, adler32(bytes))
  return out
}

const stub = (jpegSize: (r: Raster) => number, seen: Raster[] = []): Codec => ({
  openJpeg: () => Promise.reject(new Error('unused')),
  encodeJpeg: async (r) => {
    seen.push(r)
    return new Uint8Array(jpegSize(r))
  },
})

async function flateImage(doc: PDFDocument, width: number, height: number, channels: 1 | 3, extra: Literal = {}) {
  const stream = doc.context.stream(await deflate(gradient(width, height, channels)), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: channels === 3 ? 'DeviceRGB' : 'DeviceGray',
    BitsPerComponent: 8,
    Filter: 'FlateDecode',
    ...extra,
  } as never)
  return doc.context.register(stream)
}

function ascii85(bytes: Uint8Array): Uint8Array {
  let text = ''
  for (let i = 0; i < bytes.length; i += 4) {
    const n = Math.min(4, bytes.length - i)
    let value = 0
    for (let j = 0; j < 4; j++) value = value * 256 + (j < n ? bytes[i + j] : 0)
    const digits = Array.from({ length: 5 }, (_, k) => String.fromCharCode(33 + (Math.floor(value / 85 ** (4 - k)) % 85)))
    text += n === 4 && value === 0 ? 'z' : digits.slice(0, n + 1).join('')
  }
  return new TextEncoder().encode(text + '~>')
}

const lookup = (doc: PDFDocument, ref: PDFRef) => doc.context.lookup(ref) as PDFRawStream
const entry = (stream: PDFRawStream, key: string): PDFObject | undefined => stream.dict.get(PDFName.of(key))
const number = (stream: PDFRawStream, key: string) => (entry(stream, key) as PDFNumber).asNumber()

describe('compressImages', () => {
  it('shrinks an oversampled Flate photo to 150 dpi as JPEG and keeps its soft mask', async () => {
    const doc = await PDFDocument.create()
    const mask = doc.context.register(doc.context.stream(new Uint8Array(30), { Subtype: 'Image', Width: 3, Height: 3, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never))
    const ref = await flateImage(doc, 1200, 800, 3, { SMask: mask, Intent: 'Perceptual' })
    // 5 x 3.33 inch: 750 x 500 pixels would do.
    const page = doc.addPage([360, 240])
    page.node.newXObject('Im', ref)
    const seen: Raster[] = []

    const stats = await compressImages(doc, collectImages([page]), undefined, stub(() => 9_000, seen))

    const out = lookup(doc, ref)
    expect(entry(out, 'Filter')).toBe(PDFName.of('DCTDecode'))
    expect([number(out, 'Width'), number(out, 'Height')]).toEqual([750, 500])
    expect(entry(out, 'ColorSpace')).toBe(PDFName.of('DeviceRGB'))
    expect(entry(out, 'SMask')).toBe(mask)
    expect(entry(out, 'Intent')).toBe(PDFName.of('Perceptual'))
    expect(entry(out, 'DecodeParms')).toBeUndefined()
    expect(out.contents).toHaveLength(9_000)
    expect(seen[0]).toMatchObject({ width: 750, height: 500, channels: 3 })
    expect(stats.images).toBe(1)
    expect(stats.replaced).toBe(1)
    expect(stats.saved).toBeGreaterThan(0)
  })

  it('undoes ASCII85 before decoding and drops it from the result', async () => {
    const doc = await PDFDocument.create()
    const original = gradient(800, 600, 3)
    const wrapped = ascii85(await deflate(original))
    const ref = doc.context.register(
      doc.context.stream(wrapped, { Subtype: 'Image', Width: 800, Height: 600, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: ['ASCII85Decode', 'FlateDecode'] } as never),
    )
    const page = doc.addPage([240, 180])
    page.node.newXObject('Im', ref)
    const seen: Raster[] = []
    const stats = await compressImages(doc, collectImages([page]), undefined, stub(() => 9_000, seen))

    expect(entry(lookup(doc, ref), 'Filter')).toBe(PDFName.of('DCTDecode'))
    expect(seen[0]).toMatchObject({ width: 500, height: 375 })
    expect(stats.saved).toBe(wrapped.length - 9_000)
    // What reached the encoder is the original picture, averaged, so ASCII85 was undone first.
    const mean = (original[0] + original[3] + original[2400] + original[2403]) / 4
    expect(Math.abs(seen[0].data[0] - mean)).toBeLessThan(60)
  })

  it('serves the largest page when two pages show the image', async () => {
    const doc = await PDFDocument.create()
    const ref = await flateImage(doc, 1200, 800, 3)
    const small = doc.addPage([180, 120])
    const big = doc.addPage([360, 240])
    small.node.newXObject('Im', ref)
    big.node.newXObject('Im', ref)
    await compressImages(doc, collectImages([small, big]), undefined, stub(() => 9_000))
    expect(number(lookup(doc, ref), 'Width')).toBe(750)
  })

  it('undoes PNG predictors before it looks at the pixels', async () => {
    const doc = await PDFDocument.create()
    const width = 600
    const height = 400
    const flat = gradient(width, height, 3)
    const filtered = new Uint8Array((width * 3 + 1) * height)
    for (let y = 0; y < height; y++) {
      filtered[y * (width * 3 + 1)] = 2
      for (let i = 0; i < width * 3; i++) filtered[y * (width * 3 + 1) + 1 + i] = flat[y * width * 3 + i] - (y > 0 ? flat[(y - 1) * width * 3 + i] : 0)
    }
    const stream = doc.context.stream(await deflate(filtered), {
      Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: 3, Columns: width, BitsPerComponent: 8 },
    } as never)
    const ref = doc.context.register(stream)
    const page = doc.addPage([144, 96])
    page.node.newXObject('Im', ref)
    const seen: Raster[] = []
    await compressImages(doc, collectImages([page]), undefined, stub(() => 3_000, seen))
    expect(seen[0].width).toBe(300)
    // Averaging 2x2 blocks of the original gives the same numbers only if the rows were reconstructed.
    const first = (flat[0] + flat[3] + flat[width * 3] + flat[width * 3 + 3]) / 4
    expect(Math.abs(seen[0].data[0] - first)).toBeLessThanOrEqual(1)
    expect(entry(lookup(doc, ref), 'DecodeParms')).toBeUndefined()
  })

  async function grayText(doc: PDFDocument, width: number, height: number) {
    const text = textPage(width, height)
    const ref = doc.context.register(
      doc.context.stream(stored(text), { Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' } as never),
    )
    return { text, ref }
  }

  it('packs a black-and-white scan into one bit per pixel without changing a pixel', async () => {
    const doc = await PDFDocument.create()
    const { text, ref } = await grayText(doc, 800, 480)
    // 400 x 240 pt is 833 x 500 pixels at 150 dpi, so the 800 x 480 scan is kept at its size.
    const page = doc.addPage([400, 240])
    page.node.newXObject('Im', ref)
    const before = lookup(doc, ref).contents.length
    await compressImages(doc, collectImages([page]), undefined, stub(() => 50_000))

    const out = lookup(doc, ref)
    expect(out.contents.length).toBeLessThan(before / 5)
    expect(entry(out, 'Filter')).toBe(PDFName.of('FlateDecode'))
    expect(number(out, 'BitsPerComponent')).toBe(1)
    expect(entry(out, 'ColorSpace')).toBe(PDFName.of('DeviceGray'))
    expect(entry(out, 'Decode')).toBeUndefined()
    const parms = entry(out, 'DecodeParms') as PDFDict
    expect(['Predictor', 'Colors', 'BitsPerComponent', 'Columns'].map((k) => parms.lookup(PDFName.of(k), PDFNumber).asNumber())).toEqual([15, 1, 1, 800])
    const packed = unpredict(await inflate(out.contents), { predictor: 15, colors: 1, columns: 100 }, 480)
    expect(packed).toEqual(packBilevel(text, 800, 480))
  })

  it('keeps a downscaled grey scan lossless when that beats JPEG', async () => {
    const doc = await PDFDocument.create()
    const { ref } = await grayText(doc, 800, 480)
    const page = doc.addPage([192, 115.2])
    page.node.newXObject('Im', ref)
    const seen: Raster[] = []
    await compressImages(doc, collectImages([page]), undefined, stub(() => 500_000, seen))

    const out = lookup(doc, ref)
    expect(seen[0]).toMatchObject({ width: 400, height: 240 })
    expect(entry(out, 'Filter')).toBe(PDFName.of('FlateDecode'))
    expect([number(out, 'BitsPerComponent'), number(out, 'Width'), number(out, 'Height')]).toEqual([8, 400, 240])
    const gray = unpredict(await inflate(out.contents), { predictor: 15, colors: 1, columns: 400 }, 240)!
    expect(gray).toHaveLength(96_000)
    expect(gray.some((v) => v > 0 && v < 255)).toBe(true)
  })

  it('prefers JPEG for continuous-tone grey when it is smaller', async () => {
    const doc = await PDFDocument.create()
    const ref = await flateImage(doc, 1200, 800, 1)
    const page = doc.addPage([360, 240])
    page.node.newXObject('Im', ref)
    await compressImages(doc, collectImages([page]), undefined, stub(() => 20_000))
    const out = lookup(doc, ref)
    expect(entry(out, 'Filter')).toBe(PDFName.of('DCTDecode'))
    expect(entry(out, 'ColorSpace')).toBe(PDFName.of('DeviceRGB'))
  })

  it('never makes an image bigger', async () => {
    const doc = await PDFDocument.create()
    const ref = await flateImage(doc, 1200, 800, 3)
    const page = doc.addPage([360, 240])
    page.node.newXObject('Im', ref)
    const before = lookup(doc, ref)
    const stats = await compressImages(doc, collectImages([page]), undefined, stub(() => before.contents.length + 1))
    expect(lookup(doc, ref)).toBe(before)
    expect(stats).toMatchObject({ images: 1, replaced: 0, saved: 0 })
  })

  it('leaves CCITT, JBIG2, CMYK and small images untouched', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([100, 100])
    const make = (extra: Literal, size = 20_000) => {
      const ref = doc.context.register(doc.context.stream(new Uint8Array(size), { Subtype: 'Image', Width: 3000, Height: 3000, BitsPerComponent: 8, ...extra } as never))
      page.node.newXObject('Im', ref)
      return ref
    }
    const refs = [
      make({ ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode' }),
      make({ ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'JBIG2Decode' }),
      make({ ColorSpace: 'DeviceCMYK', Filter: 'FlateDecode' }),
      make({ ColorSpace: 'DeviceRGB', Filter: 'FlateDecode' }, 500),
    ]
    const before = refs.map((r) => lookup(doc, r))
    const seen: Raster[] = []
    const stats = await compressImages(doc, collectImages([page]), undefined, stub(() => 1, seen))
    expect(refs.map((r) => lookup(doc, r))).toEqual(before)
    refs.forEach((r, i) => expect(lookup(doc, r)).toBe(before[i]))
    expect(seen).toHaveLength(0)
    expect(stats).toMatchObject({ images: 4, replaced: 0 })
  })

  it('survives a stream it cannot read and carries on', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([100, 100])
    const broken = doc.context.register(
      doc.context.stream(new Uint8Array(20_000).fill(7), { Subtype: 'Image', Width: 2000, Height: 2000, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' } as never),
    )
    const good = await flateImage(doc, 1200, 800, 3)
    page.node.newXObject('A', broken)
    page.node.newXObject('B', good)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stats = await compressImages(doc, collectImages([page]), undefined, stub(() => 100))
    warn.mockRestore()
    expect(stats.replaced).toBe(1)
    expect(entry(lookup(doc, good), 'Filter')).toBe(PDFName.of('DCTDecode'))
  })

  it('lets the progress callback cancel', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([100, 100])
    page.node.newXObject('A', await flateImage(doc, 1200, 800, 3))
    const cancel = () => {
      throw new DOMException('Abgebrochen', 'AbortError')
    }
    await expect(compressImages(doc, collectImages([page]), cancel, stub(() => 100))).rejects.toThrow('Abgebrochen')
  })
})

function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const v of bytes) {
    crc ^= v
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

/** A minimal RGB PNG, for the image sources pdf-lib has to embed. */
async function png(width: number, height: number): Promise<Uint8Array> {
  const pixels = gradient(width, height, 3)
  const rows = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1)
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set([...type].map((c) => c.charCodeAt(0)), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, width)
  new DataView(ihdr.buffer).setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(rows)), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

describe('buildPdf with compress', () => {
  const imageSource = async (id: string): Promise<Source> => ({
    id,
    name: id,
    kind: 'image',
    mime: 'image/png',
    bytes: await png(600, 400),
    pages: [{ width: 144, height: 96 }],
  })

  async function textPdf(): Promise<Source> {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([200, 300])
    page.drawText('Rechnung 42', { x: 10, y: 10, font })
    const image = await doc.embedPng(await png(500, 500))
    page.drawImage(image, { x: 0, y: 100, width: 100, height: 100 })
    return { id: 'doc', name: 'doc', kind: 'pdf', mime: 'application/pdf', bytes: await doc.save(), pages: [{ width: 200, height: 300 }] }
  }

  it('recompresses image sources and images inside PDFs, keeps text, and reports', async () => {
    const photo = await imageSource('photo')
    const text = await textPdf()
    const pages: Page[] = [
      { id: '1', sourceId: 'photo', index: 0, rotation: 0 },
      { id: '2', sourceId: 'doc', index: 0, rotation: 0 },
      { id: '3', sourceId: 'photo', index: 0, rotation: 0 },
    ]
    const sources = { photo, doc: text }
    const normal = await buildPdf(pages, sources, 'Test')
    let stats: { images: number; replaced: number; saved: number } | undefined
    const progress: number[][] = []
    const small = await buildPdf(pages, sources, 'Test', (d, t) => progress.push([d, t]), { compress: true, onCompressed: (s) => (stats = s) })

    expect(small.length).toBeLessThan(normal.length)
    // The photo is shared by two pages, so there are two images, not three.
    expect(stats).toMatchObject({ images: 2, replaced: 2 })
    expect(stats!.saved).toBeGreaterThan(0)
    expect(progress.at(-1)).toEqual([1000, 1000])
    expect(progress.every(([d, t], i) => t === 1000 && (i === 0 || d >= progress[i - 1][0]))).toBe(true)

    const out = await PDFDocument.load(small)
    expect(out.getPageCount()).toBe(3)
    const images = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'))
    expect(images.filter(([, o]) => (o as PDFRawStream).dict.lookup(PDFName.of('Filter')) === PDFName.of('DCTDecode'))).toHaveLength(2)
    const textPage = out.getPage(1)
    const original = (await PDFDocument.load(text.bytes!)).getPage(0)
    const content = (page: typeof textPage) => {
      const c = page.node.Contents()
      const list = c instanceof PDFArray ? c.asArray().map((r) => page.doc.context.lookup(r, PDFStream)) : [c as PDFStream]
      return list.map((stream) => stream.getContentsString()).join()
    }
    expect(content(textPage)).toBe(content(original))
    expect(content(textPage)).not.toBe('')
  })

  it('behaves as before without the option', async () => {
    const photo = await imageSource('photo')
    const pages: Page[] = [{ id: '1', sourceId: 'photo', index: 0, rotation: 0 }]
    const onCompressed = vi.fn()
    const progress: number[][] = []
    await buildPdf(pages, { photo }, 'Test', (d, t) => progress.push([d, t]), { onCompressed })
    expect(onCompressed).not.toHaveBeenCalled()
    expect(progress).toEqual([[1, 1]])
  })
})

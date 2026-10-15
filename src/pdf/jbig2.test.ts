import { readFileSync } from 'node:fs'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { convertJbig2, decodeWith, detectJbig2, segmentTypes, stripFileHeader, type Jbig2Decoder } from './jbig2'
import { inflate } from './raster'

// Made with jbig2enc from jbig2-source.pbm (301 x 120): `jbig2 -p` and `jbig2 -s -p`.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const generic = fixture('jbig2-generic.jb2')
const symbols = fixture('jbig2-symbols.jb2')
const globals = fixture('jbig2-symbols.sym')
const W = 301
const H = 120
const ROW = (W + 7) >> 3

// pdf.js's plain JavaScript build of the decoder, the same the app loads.
const fallback = 'pdfjs-dist/wasm/jbig2_nowasm_fallback.js'
const decoder = (await import(/* @vite-ignore */ fallback)).default()
const decode: Jbig2Decoder = async (data, w, h, g) => decodeWith(await decoder, data, w, h, g)

/** The source image as JBIG2Decode yields it: PBM has 1 for black, PDF grey 0. */
function expectedRows(): Uint8Array {
  const pbm = fixture('jbig2-source.pbm')
  const header = new TextDecoder().decode(pbm.subarray(0, 20)).match(/^P4\s+\d+\s+\d+\s/)![0]
  return pbm.subarray(header.length).map((b) => ~b & 0xff)
}

/** Undoes the PNG Up predictor of a 1-bit image. */
function unpredictUp(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(ROW * H)
  for (let y = 0; y < H; y++) {
    for (let i = 0; i < ROW; i++) out[y * ROW + i] = data[y * (ROW + 1) + 1 + i] + (y > 0 ? out[(y - 1) * ROW + i] : 0)
  }
  return out
}

/** Clears the padding bits at the end of each row, which carry no pixels. */
const pixels = (rows: Uint8Array) => rows.map((b, i) => (i % ROW === ROW - 1 ? b & (0xff << (8 - (W % 8))) : b))

async function docWith(data: Uint8Array, global?: Uint8Array, extra: Record<string, unknown> = {}) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 120])
  const parms = global ? { DecodeParms: { JBIG2Globals: doc.context.register(doc.context.stream(global)) } } : {}
  const image = doc.context.stream(data, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'JBIG2Decode', ...parms, ...extra } as never)
  const ref = doc.context.register(image)
  page.node.newXObject('Im', ref)
  return { doc, ref }
}

describe('segmentTypes', () => {
  it('reads generic coding, symbol dictionaries and text regions', () => {
    const shapes = [0, 4, 6, 7]
    expect(segmentTypes(generic)!.some((t) => shapes.includes(t))).toBe(false)
    expect(segmentTypes(generic)).toContain(38)
    expect(segmentTypes(globals)).toContain(0)
    expect(segmentTypes(symbols)!.some((t) => shapes.includes(t))).toBe(true)
  })

  it('gives up on cut-off data', () => {
    expect(segmentTypes(generic.subarray(0, 8))).toBeNull()
  })

  it('drops a file header', () => {
    const header = new Uint8Array([0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a, 0x03])
    expect(stripFileHeader(new Uint8Array([...header, ...generic]))).toEqual(generic)
    expect(stripFileHeader(generic)).toBe(generic)
  })
})

describe('detectJbig2', () => {
  it('tells lossless from shape-coded images', async () => {
    expect(detectJbig2((await docWith(generic)).doc.getPages())).toBe('lossless')
    expect(detectJbig2((await docWith(symbols, globals)).doc.getPages())).toBe('symbols')
  })

  it('treats unreadable data as shape-coded and finds nothing in other files', async () => {
    expect(detectJbig2((await docWith(new Uint8Array([1, 2, 3]))).doc.getPages())).toBe('symbols')
    const plain = await PDFDocument.create()
    plain.addPage()
    expect(detectJbig2(plain.getPages())).toBeNull()
  })
})

describe('convertJbig2', () => {
  for (const [label, data, global] of [['generic', generic, undefined], ['symbol', symbols, globals]] as const) {
    it(`keeps every pixel of ${label} coding`, async () => {
      const { doc, ref } = await docWith(data, global, { Decode: [1, 0] })
      expect(await convertJbig2(doc, decode)).toBe(1)
      const stream = doc.context.lookup(ref) as PDFRawStream
      expect(stream.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'))
      // Everything else about the image stays as it was.
      expect(String(stream.dict.lookup(PDFName.of('Decode')))).toBe('[ 1 0 ]')
      expect(pixels(unpredictUp(await inflate(stream.contents)))).toEqual(pixels(expectedRows()))
      expect(detectJbig2(doc.getPages())).toBeNull()
    })
  }

  it('converts a JBIG2 stencil mask of another image', async () => {
    const { doc } = await docWith(generic)
    const mask = doc.context.register(doc.context.stream(generic, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ImageMask: true, Filter: 'JBIG2Decode' } as never))
    const photo = doc.context.register(doc.context.stream(new Uint8Array(3), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Mask: mask } as never))
    doc.getPage(0).node.newXObject('Photo', photo)
    expect(await convertJbig2(doc, decode)).toBe(2)
    expect((doc.context.lookup(mask) as PDFRawStream).dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'))
  })

  it('fails rather than leave an image it cannot decode', async () => {
    const { doc, ref } = await docWith(generic)
    await expect(convertJbig2(doc, () => Promise.reject(new Error('broken')))).rejects.toThrow('broken')
    await expect(convertJbig2(doc, async () => new Uint8Array(10))).rejects.toThrow('shorter')
    expect((doc.context.lookup(ref) as PDFRawStream).dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('JBIG2Decode'))
  })
})

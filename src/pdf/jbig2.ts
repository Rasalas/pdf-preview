import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFDocument, type PDFPage } from 'pdf-lib'
import { collectImages } from './compress'
import { deflate, filterUp } from './raster'

/**
 * `symbols`: at least one image was coded by matching shapes, where scanners may have put one
 * character in place of a similar one (6 and 8). `lossless`: only generic coding, which keeps every pixel.
 */
export type Jbig2Kind = 'lossless' | 'symbols'

/** Packed rows as the JBIG2Decode filter yields them: 1 bit per pixel, 0 is black. */
export type Jbig2Decoder = (data: Uint8Array, width: number, height: number, globals: Uint8Array | null) => Promise<Uint8Array>

export class Jbig2Error extends Error {
  override name = 'Jbig2Error'
}

const name = PDFName.of
const JBIG2 = name('JBIG2Decode')

// Symbol dictionary, text regions, pattern dictionary and halftone regions.
const SHAPE_SEGMENTS = new Set([0, 4, 6, 7, 16, 20, 22, 23])

/** A JBIG2 file header in front of the segments, as some producers leave it, is not part of the stream. */
export function stripFileHeader(bytes: Uint8Array): Uint8Array {
  const magic = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 9 || magic.some((b, i) => bytes[i] !== b)) return bytes
  return bytes.subarray(bytes[8] & 2 ? 9 : 13)
}

/** Segment types of an embedded stream (sequential, without file header), or null if it cannot be read. */
export function segmentTypes(data: Uint8Array): number[] | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const types: number[] = []
  let pos = 0
  while (pos < data.length) {
    if (pos + 6 > data.length) return null
    const number = view.getUint32(pos)
    const flags = data[pos + 4]
    pos += 5
    let refs = data[pos] >> 5
    if (refs === 7) {
      if (pos + 4 > data.length) return null
      refs = view.getUint32(pos) & 0x1fffffff
      pos += 4 + Math.ceil((refs + 1) / 8)
    } else if (refs > 4) {
      return null
    } else {
      pos += 1
    }
    pos += refs * (number <= 256 ? 1 : number <= 65536 ? 2 : 4) + (flags & 0x40 ? 4 : 1)
    if (pos + 4 > data.length) return null
    const length = view.getUint32(pos)
    pos += 4
    types.push(flags & 0x3f)
    // Only a generic region may leave its length open; it runs to the end of the page.
    if (length === 0xffffffff) return types
    pos += length
  }
  return types
}

function isJbig2(stream: PDFRawStream): boolean {
  const filter = stream.dict.lookup(name('Filter'))
  return filter === JBIG2 || (filter instanceof PDFArray && filter.size() === 1 && filter.lookup(0) === JBIG2)
}

function parmsOf(stream: PDFRawStream): PDFDict | undefined {
  const parms = stream.dict.lookup(name('DecodeParms'))
  const dict = parms instanceof PDFArray ? parms.lookup(0) : parms
  return dict instanceof PDFDict ? dict : undefined
}

function globalsOf(stream: PDFRawStream): Uint8Array | null {
  const globals = parmsOf(stream)?.lookup(name('JBIG2Globals'))
  return globals instanceof PDFRawStream ? stripFileHeader(decodePDFRawStream(globals).decode()) : null
}

/** JBIG2 images on the pages, also stencil masks of other images. */
function jbig2Images(pages: PDFPage[]): { ref: PDFRef; stream: PDFRawStream }[] {
  const found = new Map<string, { ref: PDFRef; stream: PDFRawStream }>()
  for (const job of collectImages(pages)) {
    const mask = job.stream.dict.get(name('Mask'))
    const candidates = [{ ref: job.ref, stream: job.stream }]
    if (mask instanceof PDFRef) {
      const stream = job.stream.dict.context.lookup(mask)
      if (stream instanceof PDFRawStream) candidates.push({ ref: mask, stream })
    }
    for (const c of candidates) if (isJbig2(c.stream)) found.set(c.ref.tag, c)
  }
  return [...found.values()]
}

/** Whether the pages hold JBIG2 images and of which kind; an image that cannot be read counts as `symbols`. */
export function detectJbig2(pages: PDFPage[]): Jbig2Kind | null {
  const images = jbig2Images(pages)
  if (images.length === 0) return null
  for (const { stream } of images) {
    try {
      const globals = globalsOf(stream)
      const types = [...(globals ? (segmentTypes(globals) ?? [0]) : []), ...(segmentTypes(stripFileHeader(stream.contents)) ?? [0])]
      if (types.some((t) => SHAPE_SEGMENTS.has(t))) return 'symbols'
    } catch {
      return 'symbols'
    }
  }
  return 'lossless'
}

let module: Promise<Jbig2Module> | undefined

interface Jbig2Module {
  _malloc(size: number): number
  _free(ptr: number): void
  _jbig2_decode(ptr: number, size: number, width: number, height: number, globals: number, globalsSize: number): void
  writeArrayToMemory(bytes: Uint8Array, ptr: number): void
  imageData: Uint8Array | null
}

/** pdf.js's decoder, the plain JavaScript build, loaded once from where vite.config.ts puts it. */
export const pdfjsDecoder: Jbig2Decoder = async (data, width, height, globals) => {
  module ??= import(/* @vite-ignore */ new URL('pdfjs/wasm/jbig2_nowasm_fallback.js', document.baseURI).href).then((m) => m.default())
  return decodeWith(await module, data, width, height, globals)
}

export function decodeWith(m: Jbig2Module, data: Uint8Array, width: number, height: number, globals: Uint8Array | null): Uint8Array {
  const ptr = m._malloc(data.length)
  const globalsPtr = globals?.length ? m._malloc(globals.length) : 0
  try {
    m.writeArrayToMemory(data, ptr)
    if (globals?.length) m.writeArrayToMemory(globals, globalsPtr)
    m._jbig2_decode(ptr, data.length, width, height, globalsPtr, globals?.length ?? 0)
    if (!m.imageData) throw new Jbig2Error('JBIG2 decoding failed')
    return m.imageData
  } finally {
    m.imageData = null
    m._free(ptr)
    if (globalsPtr) m._free(globalsPtr)
  }
}

/**
 * Rewrites every JBIG2 image of the pages as Flate with the very same pixels, for programs that
 * refuse JBIG2. Throws Jbig2Error if one cannot be decoded, since the result must not hold any.
 */
export async function convertJbig2(doc: PDFDocument, decode: Jbig2Decoder = pdfjsDecoder): Promise<number> {
  const images = jbig2Images(doc.getPages())
  for (const { ref, stream } of images) {
    const width = stream.dict.lookup(name('Width'))
    const height = stream.dict.lookup(name('Height'))
    if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) throw new Jbig2Error('JBIG2 image without size')
    const w = width.asNumber()
    const h = height.asNumber()
    const rowBytes = (w + 7) >> 3
    const rows = await decode(stripFileHeader(stream.contents), w, h, globalsOf(stream)).catch((e) => {
      throw e instanceof Jbig2Error ? e : new Jbig2Error(String(e))
    })
    if (rows.length < rowBytes * h) throw new Jbig2Error('JBIG2 image shorter than its size')
    const dict = stream.dict.clone(doc.context)
    dict.set(name('Filter'), name('FlateDecode'))
    dict.set(name('BitsPerComponent'), PDFNumber.of(1))
    dict.set(name('DecodeParms'), doc.context.obj({ Predictor: 15, Colors: 1, BitsPerComponent: 1, Columns: w }))
    doc.context.assign(ref, PDFRawStream.of(dict, await deflate(filterUp(rows.subarray(0, rowBytes * h), rowBytes, h))))
  }
  return images.length
}

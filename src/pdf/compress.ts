import { PDFArray, PDFBool, PDFDict, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFDocument, type PDFObject, type PDFPage } from 'pdf-lib'
import type { PageSize } from '../model/types'
import { browserCodec, type Codec } from './codec'
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
  type Predictor,
  type Raster,
} from './raster'

const TARGET_DPI = 150
// Images up to 1.5 times denser than the target (225 dpi) are left alone; scaling them gains little.
const OVERSAMPLED = 1.5
const JPEG_QUALITY = 0.8
const MIN_BYTES = 10_000
const MAX_PIXELS = 100_000_000
// A JPEG below this many bits per pixel is already small; a second pass would only cost quality.
const COMPACT_BPP = 1

export interface CompressStats {
  /** Image streams looked at. */
  images: number
  replaced: number
  /** Bytes the file got smaller by. */
  saved: number
}

const name = PDFName.of

/**
 * Factor (at most 1) that brings an image to 150 dpi of the largest page showing it, or 1 when it is
 * not clearly oversampled. Placement is unknown: the whole page, turned or not, is the most it can fill.
 */
export function scaleFor(width: number, height: number, pages: PageSize[]): number {
  let fit = 0
  for (const page of pages) {
    const w = (page.width / 72) * TARGET_DPI
    const h = (page.height / 72) * TARGET_DPI
    fit = Math.max(fit, Math.min(w / width, h / height), Math.min(h / width, w / height))
  }
  return fit === 0 || fit * OVERSAMPLED >= 1 ? 1 : fit
}

/** A smaller result only counts when it gains enough; re-compressing a JPEG at the same size must gain more. */
export function worthReplacing(before: number, after: number, lossyAgain: boolean): boolean {
  return after <= before * (lossyAgain ? 0.75 : 0.9)
}

export function isCompact(bytes: number, pixels: number): boolean {
  return (bytes * 8) / pixels < COMPACT_BPP
}

export type Skip = 'mask' | 'size' | 'depth' | 'decode' | 'color' | 'filter' | 'params'

export interface Plan {
  filter: 'dct' | 'flate'
  /** The colour space is a plain Device space, not a profile of its own. */
  device: boolean
  /** Encodings to undo before the codec. */
  transport: PDFName[]
  channels: 1 | 3
  width: number
  height: number
  predictor?: Predictor
}

function num(dict: PDFDict, key: string): number | undefined {
  const value = dict.lookup(name(key))
  return value instanceof PDFNumber ? value.asNumber() : undefined
}

/** Number of colour components when it is plain RGB or grey, null for CMYK, Lab, Indexed, Separation and the like. */
function channelsOf(space: PDFObject | undefined): 1 | 3 | null {
  if (space instanceof PDFName) return space === name('DeviceRGB') ? 3 : space === name('DeviceGray') ? 1 : null
  if (!(space instanceof PDFArray)) return null
  const kind = space.lookup(0)
  if (kind === name('CalRGB')) return 3
  if (kind === name('CalGray')) return 1
  if (kind !== name('ICCBased')) return null
  const profile = space.lookup(1)
  const n = profile instanceof PDFStream ? num(profile.dict, 'N') : undefined
  return n === 3 ? 3 : n === 1 ? 1 : null
}

function isIdentityDecode(decode: PDFObject | undefined): boolean {
  if (decode === undefined) return true
  if (!(decode instanceof PDFArray)) return false
  return decode.asArray().every((v, i) => v instanceof PDFNumber && v.asNumber() === i % 2)
}

// Pure transport encodings that may sit in front of the image codec, as in ASCII85 wrapped JPEGs.
const TRANSPORT = ['ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode'].map(name)

/** The image codec of the stream with its parameters, and the transport encodings around it. */
function filterChain(dict: PDFDict): { transport: PDFName[]; filter: PDFName; parms: PDFObject | undefined } | null {
  const filter = dict.lookup(name('Filter'))
  const parms = dict.lookup(name('DecodeParms'))
  if (filter instanceof PDFName) return { transport: [], filter, parms }
  if (!(filter instanceof PDFArray) || filter.size() === 0) return null
  const names = filter.asArray().map((_, i) => filter.lookup(i))
  const last = names.pop()
  if (!(last instanceof PDFName)) return null
  const transport = names.filter((n): n is PDFName => n instanceof PDFName && TRANSPORT.includes(n))
  if (transport.length !== names.length) return null
  // Parameters belong to filters by position; a lone dictionary can only be meant for a single filter.
  if (parms instanceof PDFArray) return { transport, filter: last, parms: parms.lookup(parms.size() - 1) }
  return transport.length && parms ? null : { transport, filter: last, parms }
}

function predictorOf(parms: PDFObject | undefined, channels: number, width: number): { predictor?: Predictor } | null {
  if (parms === undefined || parms === PDFNull) return {}
  if (!(parms instanceof PDFDict)) return null
  const kind = num(parms, 'Predictor') ?? 1
  if (kind === 1) return {}
  const colors = num(parms, 'Colors') ?? 1
  const columns = num(parms, 'Columns') ?? 1
  const known = kind === 2 || (kind >= 10 && kind <= 15)
  if (!known || colors !== channels || columns !== width || (num(parms, 'BitsPerComponent') ?? 8) !== 8) return null
  return { predictor: { predictor: kind, colors, columns } }
}

/**
 * Decides whether an image stream can be re-encoded safely and how it has to be read.
 * Everything with a colour model, mask or filter we cannot reproduce exactly is left alone.
 */
export function planImage(dict: PDFDict): Plan | Skip {
  if (dict.lookup(name('ImageMask')) === PDFBool.True) return 'mask'
  // A colour key mask names exact sample values, which re-encoding would change.
  if (dict.lookup(name('Mask')) instanceof PDFArray) return 'mask'
  if ((num(dict, 'SMaskInData') ?? 0) > 0) return 'mask'
  const smask = dict.lookup(name('SMask'))
  if (smask instanceof PDFStream && smask.dict.has(name('Matte'))) return 'mask'

  const width = num(dict, 'Width')
  const height = num(dict, 'Height')
  if (!width || !height || width * height > MAX_PIXELS) return 'size'
  if (!isIdentityDecode(dict.lookup(name('Decode')))) return 'decode'
  const space = dict.lookup(name('ColorSpace'))
  const channels = channelsOf(space)
  if (!channels) return 'color'
  const device = space instanceof PDFName
  const chain = filterChain(dict)
  if (!chain) return 'filter'
  const { transport, filter } = chain
  const depth = num(dict, 'BitsPerComponent')

  if (filter === name('DCTDecode')) {
    if (depth !== undefined && depth !== 8) return 'depth'
    if (chain.parms instanceof PDFDict && chain.parms.has(name('ColorTransform'))) return 'params'
    return { filter: 'dct', transport, device, channels, width, height }
  }
  // JBIG2, CCITT and JPX are already compact or not decodable everywhere; LZW and the rest are rare.
  if (filter !== name('FlateDecode')) return 'filter'
  if (depth !== 8) return 'depth'
  const parms = predictorOf(chain.parms, channels, width)
  return parms ? { filter: 'flate', transport, device, channels, width, height, ...parms } : 'params'
}

/**
 * The JPEG must be decodable and agree with the dictionary. A profile inside it is applied by the
 * browser, which suits a Device space but would stack on the PDF's own profile.
 */
export function matchesJpeg(bytes: Uint8Array, plan: Plan): boolean {
  const jpeg = readJpeg(bytes)
  if (!jpeg || jpeg.precision !== 8 || jpeg.components !== plan.channels || jpeg.width !== plan.width || jpeg.height !== plan.height) return false
  return plan.device || !jpeg.icc
}

export interface ImageJob {
  ref: PDFRef
  stream: PDFRawStream
  /** Pages that show the image, with different sizes only once. */
  pages: PageSize[]
}

/** Image XObjects of the pages, also those inside form XObjects, with the pages they appear on. */
export function collectImages(pages: PDFPage[]): ImageJob[] {
  const jobs = new Map<string, ImageJob>()
  for (const page of pages) {
    const { width, height } = page.getCropBox()
    visit(page.node.Resources(), { width, height }, jobs, new Set())
  }
  return [...jobs.values()]
}

function visit(resources: PDFDict | undefined, size: PageSize, jobs: Map<string, ImageJob>, forms: Set<string>) {
  const xobjects = resources?.lookup(name('XObject'))
  if (!(xobjects instanceof PDFDict)) return
  for (const [key, value] of xobjects.entries()) {
    const stream = xobjects.lookup(key)
    if (!(value instanceof PDFRef) || !(stream instanceof PDFStream)) continue
    const subtype = stream.dict.lookup(name('Subtype'))
    if (subtype === name('Image')) {
      if (!(stream instanceof PDFRawStream)) continue
      const job = jobs.get(value.tag) ?? { ref: value, stream, pages: [] }
      if (!job.pages.some((p) => p.width === size.width && p.height === size.height)) job.pages.push(size)
      jobs.set(value.tag, job)
    } else if (subtype === name('Form') && !forms.has(value.tag)) {
      forms.add(value.tag)
      const own = stream.dict.lookup(name('Resources'))
      visit(own instanceof PDFDict ? own : resources, size, jobs, forms)
    }
  }
}

export interface Encoded {
  filter: 'DCTDecode' | 'FlateDecode'
  width: number
  height: number
  channels: 1 | 3
  bits: 1 | 8
  /** PNG predictor applied to the Flate data. */
  predictor: boolean
  bytes: Uint8Array
}

async function lossless(gray: Raster, bilevel: boolean): Promise<Encoded> {
  const { width, height } = gray
  const rowBytes = bilevel ? (width + 7) >> 3 : width
  const samples = bilevel ? packBilevel(gray.data, width, height) : gray.data
  const bytes = await deflate(filterUp(samples, rowBytes, height))
  return { filter: 'FlateDecode', width, height, channels: 1, bits: bilevel ? 1 : 8, predictor: true, bytes }
}

async function jpeg(raster: Raster, codec: Codec): Promise<Encoded | null> {
  const bytes = await codec.encodeJpeg(raster, JPEG_QUALITY)
  const { width, height } = raster
  return bytes && { filter: 'DCTDecode', width, height, channels: 3, bits: 8, predictor: false, bytes }
}

/** Photos go to JPEG; black-and-white text and grey scans may stay lossless when that is smaller. */
export async function encodeBest(raster: Raster, codec: Codec): Promise<Encoded | null> {
  const tone = classify(raster)
  const attempts: (() => Promise<Encoded | null>)[] = []
  if (tone !== 'bilevel') attempts.push(() => jpeg(raster, codec))
  if (tone !== 'color') attempts.push(() => lossless(toGray(raster), tone === 'bilevel'))
  let best: Encoded | null = null
  for (const attempt of attempts) {
    const result = await attempt().catch(() => null)
    if (result && (!best || result.bytes.length < best.bytes.length)) best = result
  }
  return best
}

function imageStream(doc: PDFDocument, old: PDFDict, channels: number, enc: Encoded): PDFRawStream {
  const dict = old.clone(doc.context)
  const set = (key: string, value: PDFObject) => dict.set(name(key), value)
  set('Width', PDFNumber.of(enc.width))
  set('Height', PDFNumber.of(enc.height))
  set('BitsPerComponent', PDFNumber.of(enc.bits))
  set('Filter', name(enc.filter))
  if (enc.channels !== channels) set('ColorSpace', name(enc.channels === 3 ? 'DeviceRGB' : 'DeviceGray'))
  dict.delete(name('Decode'))
  dict.delete(name('DecodeParms'))
  if (enc.predictor) {
    set('DecodeParms', doc.context.obj({ Predictor: 15, Colors: enc.channels, BitsPerComponent: enc.bits, Columns: enc.width }))
  }
  return PDFRawStream.of(dict, enc.bytes)
}

async function decodeJpeg(bytes: Uint8Array, plan: Plan, target: PageSize, codec: Codec): Promise<Raster | null> {
  const opened = await codec.openJpeg(resetOrientation(bytes))
  try {
    // A different size would not line up with the page any more.
    if (opened.width !== plan.width || opened.height !== plan.height) return null
    return opened.read(target.width, target.height)
  } finally {
    opened.close()
  }
}

async function decodeFlate(bytes: Uint8Array, plan: Plan, target: PageSize): Promise<Raster | null> {
  const inflated = await inflate(bytes)
  const data = plan.predictor ? unpredict(inflated, plan.predictor, plan.height) : inflated
  const size = plan.width * plan.height * plan.channels
  if (!data || data.length < size) return null
  return downscale({ width: plan.width, height: plan.height, channels: plan.channels, data: data.subarray(0, size) }, target.width, target.height)
}

function unwrap(doc: PDFDocument, transport: PDFName[], bytes: Uint8Array): Uint8Array {
  if (transport.length === 0) return bytes
  const dict = doc.context.obj({ Filter: transport })
  return decodePDFRawStream(PDFRawStream.of(dict, bytes)).decode()
}

/** Bytes saved, 0 when the image stays as it is. */
async function recompress(doc: PDFDocument, job: ImageJob, codec: Codec): Promise<number> {
  const stored = job.stream.contents.length
  if (stored < MIN_BYTES) return 0
  const plan = planImage(job.stream.dict)
  if (typeof plan === 'string') return 0
  const payload = unwrap(doc, plan.transport, job.stream.contents)
  if (plan.filter === 'dct' && !matchesJpeg(payload, plan)) return 0
  const scale = scaleFor(plan.width, plan.height, job.pages)
  if (scale === 1 && isCompact(payload.length, plan.width * plan.height)) return 0
  const target = scaledSize(plan.width, plan.height, scale)
  const raster = plan.filter === 'dct' ? await decodeJpeg(payload, plan, target, codec) : await decodeFlate(payload, plan, target)
  const encoded = raster && (await encodeBest(raster, codec))
  if (!encoded || !worthReplacing(payload.length, encoded.bytes.length, plan.filter === 'dct' && scale === 1)) return 0
  doc.context.assign(job.ref, imageStream(doc, job.stream.dict, plan.channels, encoded))
  return stored - encoded.bytes.length
}

/**
 * Re-encodes the images in place. One broken image never fails the export; it just stays as it was.
 * `onStep` may throw to cancel.
 */
export async function compressImages(
  doc: PDFDocument,
  jobs: ImageJob[],
  onStep?: (done: number, total: number) => void,
  codec: Codec = browserCodec,
): Promise<CompressStats> {
  const stats: CompressStats = { images: jobs.length, replaced: 0, saved: 0 }
  for (const [i, job] of jobs.entries()) {
    try {
      const saved = await recompress(doc, job, codec)
      if (saved > 0) {
        stats.replaced++
        stats.saved += saved
      }
    } catch (e) {
      console.warn('Bild nicht verkleinert', e)
    }
    onStep?.(i + 1, jobs.length)
  }
  return stats
}

/** Maps a progress callback onto the part of the bar from `from` to `to` (0 to 1). */
export function subProgress(onProgress: ((done: number, total: number) => void) | undefined, from: number, to: number) {
  return onProgress && ((done: number, total: number) => onProgress(Math.round((from + (done / total) * (to - from)) * 1000), 1000))
}

export function formatSize(bytes: number): string {
  const mb = bytes >= 1e6
  const value = mb ? bytes / 1e6 : bytes >= 1e3 ? bytes / 1e3 : bytes
  const unit = mb ? 'MB' : bytes >= 1e3 ? 'KB' : 'Byte'
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: mb ? 1 : 0, maximumFractionDigits: mb ? 1 : 0 })} ${unit}`
}

/** What to tell the user about the saved file, including the case where nothing got smaller. */
export function savingsMessage(size: number, { images, saved }: CompressStats): string {
  const before = size + saved
  if (saved >= 1000 && saved >= before * 0.02) return `Gesichert: ${formatSize(size)} statt ${formatSize(before)}`
  if (images === 0) return `Gesichert: ${formatSize(size)}. Das Dokument enthält keine Bilder, die sich verkleinern ließen.`
  return `Gesichert: ${formatSize(size)}. Die Bilder ließen sich nicht weiter verkleinern.`
}

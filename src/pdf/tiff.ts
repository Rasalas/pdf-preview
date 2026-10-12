import type { PageSize } from '../model/types'
import { orientPixels, type Orientation } from './exif'
import { fromRgba, type PngImage } from './png'

/** A TIFF this decoder cannot read; the message is meant for the user. */
export class TiffError extends Error {}

/** Pixels of a JPEG-compressed page, to be stored as JPEG again instead of an enormous PNG. */
export interface LossyImage {
  rgba: Uint8Array
  width: number
  height: number
}

export interface TiffPage {
  width: number
  height: number
  /** Physical size from the resolution tags, when they say something usable. */
  size: PageSize | null
  image: PngImage | LossyImage
}

// Uncompressed, CCITT G3 and G4, LZW, JPEG (old and new style), Deflate (both codes), PackBits.
const COMPRESSIONS = [1, 3, 4, 5, 6, 7, 8, 32773, 32946]
// Bilevel, gray, RGB, palette, CMYK, YCbCr.
const PHOTOMETRICS = [0, 1, 2, 3, 5, 6]
// Pages beyond these are refused instead of risking the tab: decoded samples, and RGBA at 4 bytes per pixel.
const MAX_RAW_BYTES = 250_000_000
const MAX_RGBA_PIXELS = 50_000_000
/** A3's long edge, so that one huge scan does not dwarf the other pages. */
const MAX_PAGE_EDGE = 1191

interface Ifd {
  width: number
  height: number
  data: Uint8Array
  [tag: string]: unknown
}

interface Utif {
  decode(buffer: ArrayBuffer): Ifd[]
  decodeImage(buffer: ArrayBuffer, ifd: Ifd): void
  toRGBA8(ifd: Ifd): Uint8Array
}

async function loadUtif(): Promise<Utif> {
  const lib = (await import('utif2')) as unknown as { default?: Utif } & Utif
  return lib.default ?? lib
}

/** Decodes the pages of a TIFF one at a time, so that a long fax does not sit in memory twice. */
export async function* tiffPages(bytes: Uint8Array): AsyncGenerator<TiffPage> {
  checkHeader(bytes)
  const utif = await loadUtif()
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer)
  let ifds: Ifd[]
  try {
    ifds = pageIfds(utif.decode(buffer))
  } catch {
    throw new TiffError('Die Datei ist beschädigt.')
  }
  if (ifds.length === 0) throw new TiffError('Die Datei enthält keine Seiten.')
  for (const [i, ifd] of ifds.entries()) {
    try {
      yield decodePage(utif, buffer, ifd)
    } catch (e) {
      if (e instanceof TiffError) throw e
      throw new TiffError(ifds.length > 1 ? `Seite ${i + 1} konnte nicht gelesen werden.` : 'Das Bild konnte nicht gelesen werden.')
    }
  }
}

function checkHeader(b: Uint8Array) {
  const little = b[0] === 0x49 && b[1] === 0x49
  const big = b[0] === 0x4d && b[1] === 0x4d
  const magic = little ? b[2] | (b[3] << 8) : (b[2] << 8) | b[3]
  if (!(little || big) || (magic !== 42 && magic !== 43)) throw new TiffError('Die Datei ist kein gültiges TIFF.')
  if (magic === 43) throw new TiffError('BigTIFF (Dateien über 4 GB) wird nicht unterstützt.')
}

/** Skips reduced-resolution copies and masks, which are no pages of their own. */
export function pageIfds(ifds: Ifd[]): Ifd[] {
  const pages = ifds.filter((ifd) => !((tag(ifd, 254) ?? 0) & 0b101))
  return pages.length > 0 ? pages : ifds
}

function decodePage(utif: Utif, buffer: ArrayBuffer, ifd: Ifd): TiffPage {
  if (!ifd.t256 || !ifd.t257) throw new TiffError('Die Datei ist beschädigt.')
  const compression = tag(ifd, 259) ?? 1
  const photometric = tag(ifd, 262)
  if (!COMPRESSIONS.includes(compression)) throw new TiffError('Die Kompression dieses TIFFs wird nicht unterstützt.')
  if (photometric === undefined || !PHOTOMETRICS.includes(photometric)) throw new TiffError('Die Farbdarstellung dieses TIFFs wird nicht unterstützt.')
  const raw = Math.ceil(((tag(ifd, 256) ?? 0) * (tag(ifd, 258) ?? 1) * (tag(ifd, 277) ?? 1)) / 8) * (tag(ifd, 257) ?? 0)
  if (raw > MAX_RAW_BYTES) throw new TiffError('Die Seite ist zu groß für diesen Browser.')
  utif.decodeImage(buffer, ifd)
  const { width, height } = ifd
  if (!(width > 0 && height > 0) || !ifd.data) throw new TiffError('Das Bild konnte nicht gelesen werden.')

  const size = physicalSize(width, height, rational(ifd.t282), rational(ifd.t283), tag(ifd, 296))
  const stored = tag(ifd, 274) ?? 1
  const orientation = (stored >= 1 && stored <= 8 ? stored : 1) as Orientation
  const lossy = compression === 6 || compression === 7
  const direct = orientation === 1 && !lossy ? directImage(ifd) : null
  if (direct) return { width, height, size, image: direct }
  if (width * height > MAX_RGBA_PIXELS) throw new TiffError('Die Seite ist zu groß für diesen Browser.')
  const turned = orientPixels(utif.toRGBA8(ifd), width, height, orientation)
  const image = lossy ? turned : fromRgba(turned.rgba, turned.width, turned.height)
  const swapped = turned.width !== width && size
  return { width: turned.width, height: turned.height, size: swapped ? { width: size.height, height: size.width } : size, image }
}

/** Pixels PNG holds as they are (1 to 8 bit gray or palette, 8 bit RGB): no RGBA detour, 32x less memory for a bilevel page. */
function directImage(ifd: Ifd): PngImage | null {
  const { width, height, data } = ifd
  const photometric = tag(ifd, 262)
  const samples = tag(ifd, 277) ?? 1
  const depth = tag(ifd, 258) ?? 1
  const planar = tag(ifd, 284) ?? 1
  if (samples === 1 && [1, 2, 4, 8].includes(depth) && (photometric === 0 || photometric === 1 || photometric === 3)) {
    const rowBytes = Math.ceil((width * depth) / 8)
    if (data.length < rowBytes * height) return null
    const pixels = data.subarray(0, rowBytes * height)
    if (photometric === 3) {
      const palette = colorMap(ifd, depth)
      return palette ? { width, height, depth: depth as 8, colorType: 3, data: pixels, palette } : null
    }
    // WhiteIsZero stores 0 for white; PNG gray has 0 for black.
    return { width, height, depth: depth as 8, colorType: 0, data: photometric === 0 ? pixels.map((b) => ~b & 255) : pixels }
  }
  if (photometric === 2 && samples === 3 && depth === 8 && planar === 1 && data.length >= width * height * 3) {
    return { width, height, depth: 8, colorType: 2, data: data.subarray(0, width * height * 3) }
  }
  return null
}

function colorMap(ifd: Ifd, depth: number): Uint8Array | null {
  const map = ifd.t320
  const n = 1 << depth
  if (!Array.isArray(map) || map.length < n * 3) return null
  const palette = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    palette[i * 3] = map[i] >> 8
    palette[i * 3 + 1] = map[n + i] >> 8
    palette[i * 3 + 2] = map[2 * n + i] >> 8
  }
  return palette
}

/** Page size in points from pixel size and resolution tags, or null when they are missing or implausible. */
export function physicalSize(width: number, height: number, xres: number | undefined, yres: number | undefined, unit: number | undefined): PageSize | null {
  const perInch = unit === 3 ? 2.54 : unit === 1 ? 0 : 1
  const dpiX = (xres ?? yres ?? 0) * perInch
  const dpiY = (yres ?? xres ?? 0) * perInch
  if (![dpiX, dpiY].every((d) => d >= 10 && d <= 30000)) return null
  const w = (width / dpiX) * 72
  const h = (height / dpiY) * 72
  const scale = Math.min(1, MAX_PAGE_EDGE / Math.max(w, h))
  return { width: w * scale, height: h * scale }
}

/** The first value of a RATIONAL tag, which UTIF hands over as [[numerator, denominator]]. */
function rational(value: unknown): number | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'number') return first
  if (!Array.isArray(first) || typeof first[0] !== 'number' || !first[1]) return undefined
  return first[0] / first[1]
}

function tag(ifd: Ifd, id: number): number | undefined {
  const value = ifd[`t${id}`]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'number' ? first : undefined
}

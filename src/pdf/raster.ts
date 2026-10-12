/** Pixel helpers for image compression. Pure, so they run (and are tested) without a browser. */

export interface Raster {
  width: number
  height: number
  channels: 1 | 3
  /** 8 bit samples, rows top to bottom, no padding. */
  data: Uint8Array
}

export type Tone = 'color' | 'gray' | 'bilevel'

// Pixels whose channels differ by more than this count as coloured.
const GRAY_SPREAD = 6
// A few coloured pixels (a stamp on a scan) still make the image colour.
const GRAY_COLORED_SHARE = 0.002
// Black and white ends a bilevel image may have.
const DARK = 40
const LIGHT = 215

export function toGray(raster: Raster): Raster {
  if (raster.channels === 1) return raster
  const { width, height, data } = raster
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 0; j < out.length; i += 3, j++) {
    out[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114 + 500) / 1000
  }
  return { width, height, channels: 1, data: out }
}

/** Tells photos from grey scans and from black-and-white text, which want different encodings. */
export function classify(raster: Raster): Tone {
  const { width, height, channels, data } = raster
  const pixels = width * height
  if (channels === 3) {
    let colored = 0
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (Math.max(r, g, b) - Math.min(r, g, b) > GRAY_SPREAD && ++colored > pixels * GRAY_COLORED_SHARE) return 'color'
    }
  }
  const gray = toGray(raster).data
  const seen = new Uint8Array(256)
  let levels = 0
  for (let i = 0; i < gray.length; i++) {
    if (!seen[gray[i]]) {
      seen[gray[i]] = 1
      if (++levels > 2) return 'gray'
    }
  }
  for (let v = 0; v < 256; v++) if (seen[v] && v > DARK && v < LIGHT) return 'gray'
  return 'bilevel'
}

/** Rows split into near-equal runs, so every source pixel counts exactly once. */
function edges(n: number, parts: number): Int32Array {
  return Int32Array.from({ length: parts + 1 }, (_, i) => Math.floor((i * n) / parts))
}

/** Area average. Better than the canvas' bilinear scaling for big reductions. */
export function downscale(src: Raster, width: number, height: number): Raster {
  const { channels: ch, data } = src
  if (width >= src.width && height >= src.height) return src
  const w = Math.min(width, src.width)
  const h = Math.min(height, src.height)
  const xs = edges(src.width, w)
  const ys = edges(src.height, h)
  const out = new Uint8Array(w * h * ch)
  const stride = src.width * ch
  const sums = new Uint32Array(stride)
  for (let y = 0; y < h; y++) {
    sums.fill(0)
    for (let sy = ys[y]; sy < ys[y + 1]; sy++) {
      const row = sy * stride
      for (let i = 0; i < stride; i++) sums[i] += data[row + i]
    }
    const rows = ys[y + 1] - ys[y]
    for (let x = 0; x < w; x++) {
      const count = rows * (xs[x + 1] - xs[x])
      for (let c = 0; c < ch; c++) {
        let sum = 0
        for (let sx = xs[x]; sx < xs[x + 1]; sx++) sum += sums[sx * ch + c]
        out[(y * w + x) * ch + c] = Math.round(sum / count)
      }
    }
  }
  return { width: w, height: h, channels: ch, data: out }
}

/** Pixel size after scaling by a factor of at most 1. */
export function scaledSize(width: number, height: number, scale: number): { width: number; height: number } {
  if (scale >= 1) return { width, height }
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface Predictor {
  /** 2 is TIFF, 10 to 15 are the PNG filters. */
  predictor: number
  colors: number
  columns: number
}

/** Undoes a FlateDecode predictor for 8 bit samples. Returns null when the data does not fit. */
export function unpredict(data: Uint8Array, p: Predictor, rows: number): Uint8Array | null {
  const rowBytes = p.colors * p.columns
  const png = p.predictor >= 10
  const stride = rowBytes + (png ? 1 : 0)
  if (data.length < stride * rows) return null
  const out = new Uint8Array(rowBytes * rows)
  for (let y = 0; y < rows; y++) {
    const src = y * stride + (png ? 1 : 0)
    const dst = y * rowBytes
    const up = dst - rowBytes
    const type = png ? data[y * stride] : 0
    if (type > 4) return null
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= p.colors ? out[dst + i - p.colors] : 0
      const above = y > 0 ? out[up + i] : 0
      const aboveLeft = y > 0 && i >= p.colors ? out[up + i - p.colors] : 0
      const add = !png ? left : type === 1 ? left : type === 2 ? above : type === 3 ? (left + above) >> 1 : type === 4 ? paeth(left, above, aboveLeft) : 0
      out[dst + i] = data[src + i] + add
    }
  }
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** PNG "Up" filter on every row: pixel minus the pixel above. Makes flat areas compress well. */
export function filterUp(data: Uint8Array, rowBytes: number, rows: number): Uint8Array {
  const out = new Uint8Array((rowBytes + 1) * rows)
  for (let y = 0; y < rows; y++) {
    const dst = y * (rowBytes + 1)
    out[dst] = 2
    for (let i = 0; i < rowBytes; i++) {
      out[dst + 1 + i] = data[y * rowBytes + i] - (y > 0 ? data[(y - 1) * rowBytes + i] : 0)
    }
  }
  return out
}

/** One bit per pixel, 1 is white, rows padded to whole bytes. */
export function packBilevel(gray: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = (width + 7) >> 3
  const out = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] >= 128) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return out
}

async function through(bytes: Uint8Array, stream: DecompressionStream | CompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

/** zlib, as PDF's FlateDecode. Needs DecompressionStream (Safari 16.4+). */
export const inflate = (bytes: Uint8Array) => through(bytes, new DecompressionStream('deflate'))
export const deflate = (bytes: Uint8Array) => through(bytes, new CompressionStream('deflate'))

export interface JpegInfo {
  width: number
  height: number
  components: number
  precision: number
  /** Carries its own colour profile. */
  icc: boolean
}

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8

const startsWith = (b: Uint8Array, at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0))

/** The marker segments of a JPEG up to the start of the scan. */
function* segments(b: Uint8Array): Generator<{ marker: number; at: number; length: number }> {
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return
    const length = (b[i + 2] << 8) | b[i + 3]
    yield { marker, at: i, length }
    i += 2 + length
  }
}

/** Reads the frame header of a JPEG that browsers can decode (baseline, extended, progressive). */
export function readJpeg(b: Uint8Array): JpegInfo | null {
  if (!isJpeg(b)) return null
  let icc = false
  for (const { marker, at } of segments(b)) {
    if (marker === 0xe2 && startsWith(b, at + 4, 'ICC_PROFILE\0')) icc = true
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (marker > 0xc2 || at + 10 > b.length) return null
      return { precision: b[at + 4], height: (b[at + 5] << 8) | b[at + 6], width: (b[at + 7] << 8) | b[at + 8], components: b[at + 9], icc }
    }
  }
  return null
}

/**
 * Browsers rotate JPEGs by their EXIF orientation when decoding, PDF viewers do not.
 * Returns a copy that says "upright", so decoding gives the pixels the PDF shows.
 */
export function resetOrientation(b: Uint8Array): Uint8Array {
  if (!isJpeg(b)) return b
  for (const { marker, at, length } of segments(b)) {
    if (marker !== 0xe1 || !startsWith(b, at + 4, 'Exif\0\0')) continue
    const tiff = at + 10
    const little = b[tiff] === 0x49
    const u16 = (p: number) => (little ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1])
    const ifd = tiff + (little ? (u16(tiff + 4) | (u16(tiff + 6) << 16)) >>> 0 : ((u16(tiff + 4) << 16) | u16(tiff + 6)) >>> 0)
    if (ifd + 2 > at + 2 + length) return b
    for (let n = 0, count = u16(ifd); n < count && ifd + 2 + n * 12 + 12 <= at + 2 + length; n++) {
      const entry = ifd + 2 + n * 12
      if (u16(entry) !== 0x0112) continue
      if (u16(entry + 8) === 1) return b
      const copy = b.slice()
      copy[entry + 8] = little ? 1 : 0
      copy[entry + 9] = little ? 0 : 1
      return copy
    }
    return b
  }
  return b
}

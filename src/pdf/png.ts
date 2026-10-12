import { tiffOrientation, type Orientation } from './exif'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface PngInfo {
  width: number
  height: number
  depth: number
  /** 0 gray, 2 RGB, 3 palette, 4 gray + alpha, 6 RGBA */
  colorType: number
  interlaced: boolean
  /** RGB triplets, for palette images */
  palette: Uint8Array | null
  /** Alpha channel or a tRNS chunk */
  transparent: boolean
  orientation: Orientation
  /** The zlib stream, all IDAT chunks joined */
  idat: Uint8Array
}

/** Reads the header, palette and pixel stream without decoding. Null if this is not a well-formed PNG. */
export function readPng(bytes: Uint8Array): PngInfo | null {
  if (SIGNATURE.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const info: PngInfo = { width: 0, height: 0, depth: 0, colorType: -1, interlaced: false, palette: null, transparent: false, orientation: 1, idat: new Uint8Array() }
  const parts: Uint8Array[] = []
  for (let pos = 8; pos + 12 <= bytes.length; ) {
    const length = view.getUint32(pos)
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8))
    const data = bytes.subarray(pos + 8, pos + 8 + length)
    if (data.length < length) return null
    if (type === 'IHDR' && length >= 13) {
      info.width = view.getUint32(pos + 8)
      info.height = view.getUint32(pos + 12)
      info.depth = data[8]
      info.colorType = data[9]
      info.interlaced = data[12] === 1
    } else if (type === 'PLTE') info.palette = data
    else if (type === 'tRNS') info.transparent = true
    else if (type === 'eXIf') info.orientation = tiffOrientation(data, 0)
    else if (type === 'IDAT') parts.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }
  if (info.colorType < 0 || parts.length === 0) return null
  if (info.colorType === 4 || info.colorType === 6) info.transparent = true
  info.idat = concat(parts)
  return info
}

/** PNGs whose pixel stream a PDF can use as it is (Predictor 15): opaque, not interlaced, at most 8 bits. */
export function isPassthrough(png: PngInfo): boolean {
  if (png.interlaced || png.transparent || png.depth > 8) return false
  if (png.colorType === 2) return png.depth === 8
  if (png.colorType === 3) return !!png.palette && png.palette.length >= 3
  return png.colorType === 0
}

/** Pixels ready for PNG: rows packed without filter bytes. */
export interface PngImage {
  width: number
  height: number
  depth: 1 | 2 | 4 | 8
  /** 0 gray, 2 RGB, 3 palette, 6 RGBA */
  colorType: 0 | 2 | 3 | 6
  data: Uint8Array
  /** RGB triplets, for palette images */
  palette?: Uint8Array
}

/** Picks the smallest representation that loses nothing: 1-bit, gray, RGB or RGBA. */
export function fromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): PngImage {
  let opaque = true
  let gray = true
  let bilevel = true
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) {
      opaque = false
      break
    }
    const v = rgba[i]
    if (rgba[i + 1] !== v || rgba[i + 2] !== v) gray = bilevel = false
    else if (v !== 0 && v !== 255) bilevel = false
  }
  const pixels = width * height
  if (!opaque) return { width, height, depth: 8, colorType: 6, data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length) }
  if (bilevel) {
    const rowBytes = (width + 7) >> 3
    const data = new Uint8Array(rowBytes * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4]) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
    }
    return { width, height, depth: 1, colorType: 0, data }
  }
  if (gray) {
    const data = new Uint8Array(pixels)
    for (let i = 0; i < pixels; i++) data[i] = rgba[i * 4]
    return { width, height, depth: 8, colorType: 0, data }
  }
  const data = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    data[i * 3] = rgba[i * 4]
    data[i * 3 + 1] = rgba[i * 4 + 1]
    data[i * 3 + 2] = rgba[i * 4 + 2]
  }
  return { width, height, depth: 8, colorType: 2, data }
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 6: 4 } as const

export async function encodePng(image: PngImage): Promise<Uint8Array> {
  const { width, height, depth, colorType } = image
  const bpp = Math.max(1, (CHANNELS[colorType] * depth) >> 3)
  const rowBytes = Math.ceil((width * CHANNELS[colorType] * depth) / 8)
  const filtered = filterRows(image.data, rowBytes, height, bpp, depth === 8 && colorType !== 3)
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([depth, colorType, 0, 0, 0], 8)
  return concat([
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    ...(image.palette ? [chunk('PLTE', image.palette)] : []),
    chunk('IDAT', await deflate(filtered)),
    chunk('IEND', new Uint8Array()),
  ])
}

/** Picks the filter per row with the smallest sum of absolute values, like libpng; low bit depths stay unfiltered. */
function filterRows(data: Uint8Array, rowBytes: number, height: number, bpp: number, adaptive: boolean): Uint8Array {
  const out = new Uint8Array(height * (rowBytes + 1))
  const zero = new Uint8Array(rowBytes)
  const trial = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes)
    const above = y ? data.subarray((y - 1) * rowBytes, y * rowBytes) : zero
    const target = out.subarray(y * (rowBytes + 1))
    let best = 0
    if (adaptive) {
      let lowest = Infinity
      for (let type = 0; type <= 4; type++) {
        const score = filterRow(type, row, above, bpp, trial)
        if (score < lowest) {
          lowest = score
          best = type
        }
      }
    }
    target[0] = best
    filterRow(best, row, above, bpp, target.subarray(1, rowBytes + 1))
  }
  return out
}

/** Writes the filtered row to `dst` and returns its score. */
function filterRow(type: number, row: Uint8Array, above: Uint8Array, bpp: number, dst: Uint8Array): number {
  let score = 0
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0
    const up = above[i]
    const upLeft = i >= bpp ? above[i - bpp] : 0
    let predicted = 0
    if (type === 1) predicted = left
    else if (type === 2) predicted = up
    else if (type === 3) predicted = (left + up) >> 1
    else if (type === 4) predicted = paeth(left, up, upLeft)
    const v = (row[i] - predicted) & 255
    dst[i] = v
    score += v < 128 ? v : 256 - v
  }
  return score
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

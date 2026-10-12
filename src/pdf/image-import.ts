import { newId } from '../model/ids'
import type { PageSize, Source } from '../model/types'
import { ImportError } from './errors'
import { decodeHeic } from './heic'
import { encodePng, fromRgba, isPassthrough, readPng } from './png'
import { rasterizeSvg } from './svg'
import type { TiffPage } from './tiff'

const PT_PER_PX = 72 / 96
// Images become pages at 96 dpi, shrunk so the long edge is at most A4's.
const MAX_IMAGE_EDGE = 842
// What we draw into a canvas or let pdf-lib decode. Also iOS Safari's canvas limit (4096 x 4096).
const MAX_PIXELS = 4096 * 4096
const JPEG_QUALITY = 0.92

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'avif' | 'heic' | 'tiff' | 'svg'

const MIME: Record<ImageKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
}

interface Encoded {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
}

/** What the bytes are, whatever the file is called. HEIF brands are told apart from AVIF's. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (ascii(0, 4) === 'GIF8') return 'gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (ascii(0, 2) === 'BM') return 'bmp'
  if ((ascii(0, 2) === 'II' && bytes[2] === 42 && !bytes[3]) || (ascii(0, 2) === 'MM' && !bytes[2] && bytes[3] === 42)) return 'tiff'
  // BigTIFF has its own magic number; the TIFF reader explains why it is refused.
  if ((ascii(0, 2) === 'II' && bytes[2] === 43 && !bytes[3]) || (ascii(0, 2) === 'MM' && !bytes[2] && bytes[3] === 43)) return 'tiff'
  if (ascii(4, 8) === 'ftyp') return /^(avif|avis)$/.test(ascii(8, 12)) ? 'avif' : /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|heif)$/.test(ascii(8, 12)) ? 'heic' : null
  if (/<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096)))) return 'svg'
  return null
}

/** The kind a MIME type or file extension stands for, for files whose bytes give no hint. */
export function kindOfType(type: string): ImageKind | null {
  const match = /^image\/(?:x-ms-)?(png|jpeg|gif|webp|bmp|avif|tiff|svg\+xml|hei[cf](?:-sequence)?)$/.exec(type)
  if (!match) return null
  return (match[1] === 'svg+xml' ? 'svg' : match[1].startsWith('hei') ? 'heic' : match[1]) as ImageKind
}

/** Lossy WebP: the first image chunk is VP8, not VP8L. Animated files count as lossless, which is safe. */
export function webpIsLossy(bytes: Uint8Array): boolean {
  for (let pos = 12; pos + 8 <= bytes.length; ) {
    const fourcc = String.fromCharCode(...bytes.subarray(pos, pos + 4))
    if (fourcc === 'VP8 ') return true
    if (fourcc === 'VP8L') return false
    const size = bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)
    pos += 8 + size + (size & 1)
  }
  return false
}

/** Page size in points: 96 dpi, shrunk so the long edge is at most A4's. */
export function fitPage(width: number, height: number): PageSize {
  const scale = Math.min(PT_PER_PX, MAX_IMAGE_EDGE / Math.max(width, height))
  return { width: width * scale, height: height * scale }
}

/** Imports one image file. TIFFs yield one source per page. */
export async function importImage(file: File, declaredType: string): Promise<Source[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniffImage(bytes) ?? kindOfType(declaredType)
  if (kind === 'tiff') return importTiff(file.name, bytes)
  if (kind === 'svg') return [await importSvg(file.name, bytes)]
  return [await importRaster(file.name, bytes, kind)]
}

async function importRaster(name: string, bytes: Uint8Array, kind: ImageKind | null): Promise<Source> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], kind ? { type: MIME[kind] } : {}))
  } catch {
    // Only Safari opens HEIC itself; the others get libheif.
    if (kind === 'heic') return importHeic(name, bytes)
    throw new ImportError(`Das Bild „${name}“ kann dieser Browser nicht öffnen.`)
  }
  const { width, height } = bitmap
  const page = fitPage(width, height)
  if (kind === 'jpeg') {
    bitmap.close()
    // The bytes stay as they are. The browser has applied the EXIF orientation to the size; export does the same.
    return imageSource(name, { bytes, mime: 'image/jpeg' }, page)
  }
  if (kind === 'png') {
    const png = readPng(bytes)
    // pdf-lib decodes what it cannot pass through, so those stay small. Browsers differ on EXIF orientation in
    // PNGs; the canvas pins preview and export to the same pixels.
    if (png && png.orientation === 1 && (isPassthrough(png) || png.width * png.height <= MAX_PIXELS)) {
      bitmap.close()
      return imageSource(name, { bytes, mime: 'image/png' }, page)
    }
  }
  const canvas = drawn(bitmap, width, height)
  bitmap.close()
  return imageSource(name, await encodeCanvas(canvas, isPhoto(kind, bytes), name), page)
}

async function importHeic(name: string, bytes: Uint8Array): Promise<Source> {
  try {
    const { width, height, pixels } = await decodeHeic(bytes)
    const canvas = drawn(await createImageBitmap(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height)), width, height)
    return imageSource(name, await encodeCanvas(canvas, true, name), fitPage(width, height))
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new ImportError(`Das HEIC-Foto „${name}“ konnte nicht geöffnet werden. Die Datei ist vielleicht beschädigt.`)
  }
}

async function importSvg(name: string, bytes: Uint8Array): Promise<Source> {
  try {
    const { canvas, size } = await rasterizeSvg(new TextDecoder().decode(bytes))
    return imageSource(name, await encodeCanvas(canvas, false, name), fitPage(size.width, size.height))
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new ImportError(`Die SVG-Datei „${name}“ konnte nicht gelesen werden.`)
  }
}

async function importTiff(name: string, bytes: Uint8Array): Promise<Source[]> {
  const { tiffPages, TiffError } = await import('./tiff')
  const sources: Source[] = []
  try {
    for await (const page of tiffPages(bytes)) {
      sources.push(imageSource(name, await encodeTiffPage(page, name), page.size ?? fitPage(page.width, page.height)))
      // A long scan would otherwise freeze the page until the last sheet is done.
      await new Promise((resolve) => setTimeout(resolve))
    }
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new ImportError(e instanceof TiffError ? `„${name}“: ${e.message}` : `„${name}“ konnte nicht als TIFF gelesen werden.`)
  }
  return sources
}

async function encodeTiffPage(page: TiffPage, name: string): Promise<Encoded> {
  const { image } = page
  if (!('rgba' in image)) return { bytes: await encodePng(image), mime: 'image/png' }
  // JPEG inside the TIFF: the pages are lossy already, and PNG would be ten times the size.
  const pixels = new ImageData(new Uint8ClampedArray(image.rgba.buffer as ArrayBuffer, image.rgba.byteOffset, image.rgba.length), image.width, image.height)
  return encodeCanvas(drawn(await createImageBitmap(pixels), image.width, image.height), true, name)
}

const imageSource = (name: string, { bytes, mime }: Encoded, page: PageSize): Source => ({
  id: newId(),
  name,
  kind: 'image',
  mime,
  bytes,
  pages: [page],
})

/** Formats that are lossy, and photographs in practice: JPEG is the better container when nothing is transparent. */
function isPhoto(kind: ImageKind | null, bytes: Uint8Array) {
  return kind === 'heic' || kind === 'avif' || (kind === 'webp' && webpIsLossy(bytes))
}

/** Draws into a canvas of at most MAX_PIXELS, so huge images neither crash the tab nor bloat the PDF. */
function drawn(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** PNG (smallest lossless form) or, for opaque photos, JPEG. */
async function encodeCanvas(canvas: HTMLCanvasElement, photo: boolean, name: string): Promise<Encoded> {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  if (photo && isOpaque(data)) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (blob) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' }
  } else if (typeof CompressionStream !== 'undefined') {
    return { bytes: await encodePng(fromRgba(data, width, height)), mime: 'image/png' }
  } else {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }
  }
  throw new ImportError(`Das Bild „${name}“ ist zu groß für diesen Browser.`)
}

function isOpaque(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false
  return true
}

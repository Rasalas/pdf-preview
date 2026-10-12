import {
  PDFHexString,
  PDFRawStream,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib'
import type { Source } from '../model/types'
import { orientationMatrix, readOrientation, type Orientation } from './exif'
import { isPassthrough, readPng, type PngInfo } from './png'

export interface EmbeddedImage {
  ref: PDFRef
  /** EXIF orientation of a JPEG, which pdf-lib ignores. Other sources are converted upright at import. */
  orientation: Orientation
}

export async function embedImage(doc: PDFDocument, source: Source): Promise<EmbeddedImage> {
  const bytes = source.bytes!
  if (source.mime !== 'image/png') return { ref: (await doc.embedJpg(bytes)).ref, orientation: readOrientation(bytes) }
  const png = readPng(bytes)
  return { ref: png && isPassthrough(png) ? embedPassthroughPng(doc, png) : (await doc.embedPng(bytes)).ref, orientation: 1 }
}

/** Fills the page with the image, turned and mirrored the way the browser shows it. */
export function drawImage(page: PDFPage, { ref, orientation }: EmbeddedImage, width: number, height: number) {
  const name = page.node.newXObject('Image', ref)
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...orientationMatrix(orientation, width, height)), drawObject(name), popGraphicsState())
}

/** Embeds the PNG's compressed pixels unchanged. Far faster and smaller than pdf-lib's own PNG path, which expands everything to 8-bit RGB. */
function embedPassthroughPng(doc: PDFDocument, png: PngInfo): PDFRef {
  const { context } = doc
  const colorSpace =
    png.colorType === 3
      ? ['Indexed', 'DeviceRGB', png.palette!.length / 3 - 1, PDFHexString.of([...png.palette!].map((b) => b.toString(16).padStart(2, '0')).join(''))]
      : png.colorType === 2
        ? 'DeviceRGB'
        : 'DeviceGray'
  const dict = context.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: png.width,
    Height: png.height,
    ColorSpace: colorSpace,
    BitsPerComponent: png.depth,
    Filter: 'FlateDecode',
    DecodeParms: { Predictor: 15, Colors: png.colorType === 2 ? 3 : 1, BitsPerComponent: png.depth, Columns: png.width },
  })
  return context.register(PDFRawStream.of(dict, png.idat))
}

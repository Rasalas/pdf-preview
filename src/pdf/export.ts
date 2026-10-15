export { savingsMessage } from './compress'
import {
  BlendMode,
  EncryptedPDFError,
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  closePath,
  concatTransformationMatrix,
  degrees,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { LINE_HEIGHT, TEXT_ASCENT, arrowHead, lineEnd, userSpaceMatrix } from '../model/annotations'
import type { FieldValue, FieldValues } from '../model/forms'
import type { OcrResults } from '../model/ocr'
import type { Annotation, Page, Point, Rect, Source, Sources } from '../model/types'
import { collectImages, compressImages, subProgress, type CompressStats } from './compress'
import { applyCrop } from './crop'
import { encodable } from './encodable'
import { fillForm } from './fill'
import { convertJbig2 } from './jbig2'
import { drawImage, embedImage, type EmbeddedImage } from './images'
import { drawOcrText } from './ocr-text'

const loaded = new Map<string, Promise<PDFDocument>>()

/** pdf-lib is compiled to ES5, where `instanceof` fails for its error subclasses. */
export const isEncryptedError = (e: unknown) => e instanceof Error && e.message === new EncryptedPDFError().message

/** Rejects for encrypted files (see isEncryptedError); import unlocks them first. */
export function loadForExport(id: string, bytes: Uint8Array): Promise<PDFDocument> {
  let doc = loaded.get(id)
  if (!doc) {
    doc = PDFDocument.load(bytes, { updateMetadata: false })
    doc.catch(() => loaded.delete(id))
    loaded.set(id, doc)
  }
  return doc
}

/** The source as a pdf-lib document, with the user's form entries written in and flattened if there are any. */
async function documentFor(source: Source, entered: Record<string, FieldValue> | undefined): Promise<PDFDocument> {
  if (!entered || Object.keys(entered).length === 0) return loadForExport(source.id, source.bytes!)
  // Flattening changes the document, so it must not touch the cached one.
  const doc = await PDFDocument.load(source.bytes!, { updateMetadata: false })
  const skipped = await fillForm(doc, entered)
  if (skipped.length) console.warn(`Felder in „${source.name}“ nicht übernommen:`, skipped)
  return doc
}

export interface BuildOptions {
  /** Form entries per source, written into the pages. */
  fields?: FieldValues
  /** Recognised text per source page, written into the pages as invisible text. */
  ocr?: OcrResults
  /** Downsample and recompress images; text, fonts and vector graphics stay as they are. */
  compress?: boolean
  /** Receives what compression achieved just before the bytes are returned. */
  onCompressed?: (stats: CompressStats) => void
  /** Rewrite JBIG2 images losslessly as Flate, for programs that refuse JBIG2. */
  withoutJbig2?: boolean
}

export async function buildPdf(
  pages: Page[],
  sources: Sources,
  title: string,
  onProgress?: (done: number, total: number) => void,
  options: BuildOptions = {},
): Promise<Uint8Array> {
  // Compressing is the slow part, so building the pages takes only the first tenth of the bar.
  const reportPage = options.compress ? subProgress(onProgress, 0, 0.1) : onProgress
  const out = await PDFDocument.create()
  out.setTitle(title)
  out.setProducer('Vorschau Web')
  out.setCreator('Vorschau Web')

  // Copy all PDF pages of one source in a single call so shared resources (fonts, images) are copied once.
  const copied = new Map<Page, ReturnType<PDFDocument['addPage']>>()
  for (const sourceId of new Set(pages.map((p) => p.sourceId))) {
    const source = sources[sourceId]
    if (source.kind !== 'pdf' || !source.bytes) continue
    const own = pages.filter((p) => p.sourceId === sourceId)
    const doc = await documentFor(source, options.fields?.[source.id])
    const copies = await out.copyPages(doc, own.map((p) => p.index))
    own.forEach((p, i) => copied.set(p, copies[i]))
  }

  const images = new Map<string, EmbeddedImage>()
  const cropped: { page: PDFPage; rotate: number; crop: Rect }[] = []
  let font: PDFFont | undefined
  const getFont = async () => (font ??= await out.embedFont(StandardFonts.Helvetica))
  for (const [i, page] of pages.entries()) {
    const source = sources[page.sourceId]
    if (source.kind === 'pdf') {
      const pdfPage = out.addPage(copied.get(page)!)
      const own = pdfPage.getRotation().angle
      if (page.annotations?.length) await drawAnnotations(out, pdfPage, own, page.annotations, getFont)
      const read = options.ocr?.[source.id]?.[page.index]
      if (read?.lines.length) drawOcrText(out, pdfPage, own, read, source.pages[page.index], await getFont(), page.crop)
      pdfPage.setRotation(degrees((own + page.rotation) % 360))
      if (page.crop) cropped.push({ page: pdfPage, rotate: own, crop: page.crop })
    } else {
      const { width, height } = source.pages[page.index]
      const pdfPage = out.addPage([width, height])
      if (source.kind === 'image' && source.bytes) {
        let image = images.get(source.id)
        if (!image) {
          image = await embedImage(out, source)
          images.set(source.id, image)
        }
        drawImage(pdfPage, image, width, height)
      }
      if (page.annotations?.length) await drawAnnotations(out, pdfPage, 0, page.annotations, getFont)
      const read = options.ocr?.[source.id]?.[page.index]
      if (read?.lines.length) drawOcrText(out, pdfPage, 0, read, source.pages[page.index], await getFont(), page.crop)
      pdfPage.setRotation(degrees(page.rotation))
      if (page.crop) cropped.push({ page: pdfPage, rotate: 0, crop: page.crop })
    }
    reportPage?.(i + 1, pages.length)
  }
  if (options.withoutJbig2) await convertJbig2(out)
  if (options.compress) {
    // Images of image sources are only embedded on flush.
    await out.flush()
    // Not inside the optional call, which would skip compressing without a callback.
    const stats = await compressImages(out, collectImages(out.getPages()), subProgress(onProgress, 0.1, 1))
    options.onCompressed?.(stats)
  }
  // Last, so compression still sizes images by the whole page, which they keep covering.
  for (const { page, rotate, crop } of cropped) applyCrop(page, rotate, crop)
  return out.save()
}

/**
 * Draws annotations into the page content ("flattened"), so every viewer shows them.
 * Coordinates are set up so that drawing happens in the page's displayed orientation, y up.
 */
async function drawAnnotations(
  doc: PDFDocument,
  page: PDFPage,
  rotate: number,
  annotations: Annotation[],
  getFont: () => Promise<PDFFont>,
) {
  // Isolate existing content so its graphics state cannot leak into ours.
  page.node.normalize()
  const ctx = doc.context
  page.node.wrapContentStreams(
    ctx.register(ctx.contentStream([pushGraphicsState()])),
    ctx.register(ctx.contentStream([popGraphicsState()])),
  )
  const box = page.getCropBox()
  const height = rotate % 180 ? box.width : box.height
  const flip = ([x, y]: Point): Point => [x, height - y]
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...userSpaceMatrix(rotate, box)))

  for (const a of annotations) {
    const color = hexToRgb(a.color)
    switch (a.type) {
      case 'highlight':
        for (const r of a.rects) {
          page.drawRectangle({ x: r.x, y: height - r.y - r.h, width: r.w, height: r.h, color, opacity: 0.4, blendMode: BlendMode.Multiply })
        }
        break
      case 'rect':
        page.drawRectangle({ x: a.x, y: height - a.y - a.h, width: a.w, height: a.h, borderColor: color, borderWidth: a.width })
        break
      case 'ellipse':
        page.drawEllipse({ x: a.x + a.w / 2, y: height - a.y - a.h / 2, xScale: a.w / 2, yScale: a.h / 2, borderColor: color, borderWidth: a.width })
        break
      case 'line':
        strokePath(page, [[a.p1, a.arrow ? lineEnd(a.p1, a.p2, a.width) : a.p2]].map((p) => p.map(flip)), color, a.width)
        if (a.arrow) {
          const [tip, l, r] = arrowHead(a.p1, a.p2, a.width).map(flip)
          page.pushOperators(setFillingRgbColor(color.red, color.green, color.blue), moveTo(...tip), lineTo(...l), lineTo(...r), closePath(), fill())
        }
        break
      case 'ink':
        strokePath(page, a.paths.map((p) => p.map(flip)), color, a.width)
        break
      case 'text': {
        const f = await getFont()
        a.text.split('\n').forEach((line, i) => {
          page.drawText(encodable(f, line), {
            x: a.x,
            y: height - a.y - a.size * (TEXT_ASCENT + i * LINE_HEIGHT),
            size: a.size,
            font: f,
            color,
          })
        })
        break
      }
    }
  }
  page.pushOperators(popGraphicsState())
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

function strokePath(page: PDFPage, paths: Point[][], color: ReturnType<typeof rgb>, width: number) {
  const ops = [setStrokingRgbColor(color.red, color.green, color.blue), setLineWidth(width), setLineCap(LineCapStyle.Round), setLineJoin(1)]
  for (const path of paths) {
    if (path.length === 0) continue
    // A single point still has to show up as a dot.
    const points = path.length === 1 ? [path[0], path[0]] : path
    ops.push(moveTo(...points[0]), ...points.slice(1).map((p) => lineTo(...p)))
  }
  page.pushOperators(pushGraphicsState(), ...ops, stroke(), popGraphicsState())
}

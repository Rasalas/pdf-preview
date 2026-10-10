export { EncryptedPDFError } from 'pdf-lib'
import {
  BlendMode,
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
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import { LINE_HEIGHT, TEXT_ASCENT, arrowHead, lineEnd, userSpaceMatrix } from '../model/annotations'
import type { Annotation, Page, Point, Sources } from '../model/types'

const loaded = new Map<string, Promise<PDFDocument>>()

/** Throws pdf-lib's EncryptedPDFError for encrypted files, which we cannot export yet. */
export function loadForExport(id: string, bytes: Uint8Array): Promise<PDFDocument> {
  let doc = loaded.get(id)
  if (!doc) {
    doc = PDFDocument.load(bytes, { updateMetadata: false })
    doc.catch(() => loaded.delete(id))
    loaded.set(id, doc)
  }
  return doc
}

export async function buildPdf(
  pages: Page[],
  sources: Sources,
  title: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
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
    const doc = await loadForExport(source.id, source.bytes)
    const copies = await out.copyPages(doc, own.map((p) => p.index))
    own.forEach((p, i) => copied.set(p, copies[i]))
  }

  const images = new Map<string, PDFImage>()
  let font: PDFFont | undefined
  const getFont = async () => (font ??= await out.embedFont(StandardFonts.Helvetica))
  for (const [i, page] of pages.entries()) {
    const source = sources[page.sourceId]
    if (source.kind === 'pdf') {
      const pdfPage = out.addPage(copied.get(page)!)
      const own = pdfPage.getRotation().angle
      if (page.annotations?.length) await drawAnnotations(out, pdfPage, own, page.annotations, getFont)
      pdfPage.setRotation(degrees((own + page.rotation) % 360))
    } else {
      const { width, height } = source.pages[page.index]
      const pdfPage = out.addPage([width, height])
      if (source.kind === 'image' && source.bytes) {
        let image = images.get(source.id)
        if (!image) {
          image = source.mime === 'image/png' ? await out.embedPng(source.bytes) : await out.embedJpg(source.bytes)
          images.set(source.id, image)
        }
        pdfPage.drawImage(image, { x: 0, y: 0, width, height })
      }
      if (page.annotations?.length) await drawAnnotations(out, pdfPage, 0, page.annotations, getFont)
      pdfPage.setRotation(degrees(page.rotation))
    }
    onProgress?.(i + 1, pages.length)
  }
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

/** The standard Helvetica only covers WinAnsi; replace what it cannot encode instead of failing the export. */
function encodable(font: PDFFont, text: string): string {
  return [...text]
    .map((ch) => {
      try {
        font.encodeText(ch)
        return ch
      } catch {
        return '?'
      }
    })
    .join('')
}

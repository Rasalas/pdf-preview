import {
  TextRenderingMode,
  beginText,
  concatTransformationMatrix,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { toPageSpace, userSpaceMatrix } from '../model/annotations'
import { BASELINE, toReadingRect, type OcrPage } from '../model/ocr'
import type { PageSize, Point, Rect, Rotation } from '../model/types'
import { encodable } from './encodable'

// Helvetica reaches 0.718 em above the baseline and 0.207 below, so this font size makes its box as tall as the word's.
const EM_PER_HEIGHT = 1 / 0.925
// Viewers stretch glyphs within sane limits; a box much narrower or wider than its text is a bad reading.
const MIN_SQUEEZE = 10
const MAX_SQUEEZE = 1000

export type Matrix = [number, number, number, number, number, number]

/**
 * The text matrix that puts the baseline start of a word on the page and turns its text the way it
 * runs. `read` is the word's box in the page as it was read, `rotation` how the page was turned then.
 * y points up in the page as displayed with its own /Rotate, like drawn annotations.
 */
export function wordMatrix(read: Rect, rotation: Rotation, size: PageSize): Matrix {
  const start: Point = [read.x, read.y + read.h * BASELINE]
  const at = (dx: number, dy: number) => toPageSpace([start[0] + dx, start[1] + dy], size, rotation)
  const [ox, oy] = at(0, 0)
  const [rx, ry] = at(1, 0)
  const [ux, uy] = at(0, -1)
  // `|| 0` avoids -0, which would only clutter the content stream.
  return [rx - ox, -(ry - oy) || 0, ux - ox, -(uy - oy) || 0, ox, size.height - oy]
}

/** Horizontal scaling in percent that makes `natural` points of text span `target` points. */
export const squeeze = (target: number, natural: number) =>
  natural > 0 ? Math.min(MAX_SQUEEZE, Math.max(MIN_SQUEEZE, (100 * target) / natural)) : 100

/**
 * Writes recognised words into the page as invisible text, so every viewer can search and select
 * them where they appear. `rotate` is the page's own /Rotate; `size` the source page.
 */
export function drawOcrText(doc: PDFDocument, page: PDFPage, rotate: number, ocr: OcrPage, size: PageSize, font: PDFFont) {
  if (ocr.lines.length === 0) return
  // Isolate existing content so its graphics and text state cannot leak into ours.
  page.node.normalize()
  const ctx = doc.context
  page.node.wrapContentStreams(
    ctx.register(ctx.contentStream([pushGraphicsState()])),
    ctx.register(ctx.contentStream([popGraphicsState()])),
  )
  const fontKey = page.node.newFontDictionary(font.name, font.ref)
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...userSpaceMatrix(rotate, page.getCropBox())),
    setTextRenderingMode(TextRenderingMode.Invisible),
  )
  for (const line of ocr.lines) {
    page.pushOperators(beginText())
    line.words.forEach((word, i) => {
      const read = toReadingRect(word, size, ocr.rotation)
      const fontSize = read.h * EM_PER_HEIGHT
      const text = encodable(font, word.text)
      page.pushOperators(
        setFontAndSize(fontKey, fontSize),
        setCharacterSqueeze(squeeze(read.w, font.widthOfTextAtSize(text, fontSize))),
        setTextMatrix(...wordMatrix(read, ocr.rotation, size)),
        // A space after each word but the last makes extracted text read in words.
        showText(font.encodeText(i < line.words.length - 1 ? `${text} ` : text)),
      )
    })
    page.pushOperators(endText())
  }
  page.pushOperators(popGraphicsState())
}

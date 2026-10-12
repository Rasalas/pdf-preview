import { toPageSpace } from './annotations'
import type { PageSize, Point, Rect, Rotation } from './types'

/** A recognised word. The box spans the line from the top of capitals to the bottom of descenders, at the word's position. */
export interface OcrWord extends Rect {
  text: string
}

export interface OcrLine {
  words: OcrWord[]
}

/**
 * Words of one source page, in page space like annotations: points, origin top-left, before
 * the user's rotation. `rotation` is how the page was turned when it was read, so the text
 * runs that way relative to the page and still lines up after later turns.
 */
export interface OcrPage {
  rotation: Rotation
  lines: OcrLine[]
}

/** Recognised pages by source id, then page index. Shared by every copy of a page. */
export type OcrResults = Record<string, Record<number, OcrPage>>

/** Where the baseline sits in a word's box, as a fraction of its height. */
export const BASELINE = 0.8

/** A page without this many letters and digits counts as a scan. */
const MEANINGFUL_CHARS = 20
// What the engine itself doubts is mostly noise from rules, stains and edges. Lines are judged
// as a whole first: the odd good guess inside a line of garbage does not make it text.
const MIN_WORD_CONFIDENCE = 30
const MIN_LINE_CONFIDENCE = 40
// Real pages average above 85 in the words that remain, pages read the wrong way round about 65.
const MIN_PAGE_CONFIDENCE = 75

const alphanumeric = /[\p{L}\p{N}]/gu

/** Whether text items hold real text, rather than a page number or a stamp on a scan. */
export function hasMeaningfulText(items: readonly string[]): boolean {
  let count = 0
  for (const item of items) count += item.match(alphanumeric)?.length ?? 0
  return count >= MEANINGFUL_CHARS
}

/** The searchable text of a page: one string per line, words separated by single spaces. */
export function ocrStrings(page: OcrPage): string[] {
  return page.lines.map((line) => line.words.map((w) => w.text).join(' '))
}

/** Inverse of toPageSpace: a point of the page, in the page turned by `rotation`. */
export function toReadingSpace([x, y]: Point, size: PageSize, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return [x, y]
    case 90:
      return [size.height - y, x]
    case 180:
      return [size.width - x, size.height - y]
    case 270:
      return [y, size.width - x]
  }
}

function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }
}

const corners = (r: Rect): [Point, Point] => [[r.x, r.y], [r.x + r.w, r.y + r.h]]

/** A box in the page as it was read (upright text) to the same box in page space. */
export function fromReadingRect(r: Rect, size: PageSize, rotation: Rotation): Rect {
  const [a, b] = corners(r)
  return rectBetween(toPageSpace(a, size, rotation), toPageSpace(b, size, rotation))
}

/** A box in page space to the same box in the page as it was read, where the text is upright. */
export function toReadingRect(r: Rect, size: PageSize, rotation: Rotation): Rect {
  const [a, b] = corners(r)
  return rectBetween(toReadingSpace(a, size, rotation), toReadingSpace(b, size, rotation))
}

/** The page's words with boxes in the page as it was read. */
export function readingLines(page: OcrPage, size: PageSize): OcrLine[] {
  return page.lines.map((line) => ({ words: line.words.map((w) => ({ ...w, ...toReadingRect(w, size, page.rotation) })) }))
}

/** What the engine reports for a line; the parts of tesseract.js's result that are used. */
export interface RawLine {
  confidence?: number
  words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[]
  baseline?: { x0: number; y0: number; x1: number; y1: number }
  rowAttributes?: { rowHeight: number; descenders: number }
}

export interface RawBlock {
  paragraphs: { lines: RawLine[] }[]
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Turns the engine's result into words in page space. `scale` is pixels of the rendered image per
 * point, `size` the source page, `rotation` how it was turned for rendering.
 */
export function pageFromRecognition(blocks: RawBlock[] | null, scale: number, size: PageSize, rotation: Rotation): OcrPage {
  const lines: OcrLine[] = []
  const confidences: number[] = []
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const raw of paragraph.lines) {
        if (lineConfidence(raw) < MIN_LINE_CONFIDENCE) continue
        const words: OcrWord[] = []
        for (const w of raw.words) {
          const word = toWord(w, raw, scale, size, rotation)
          if (!word) continue
          words.push(word)
          confidences.push(w.confidence)
        }
        if (words.length) lines.push({ words })
      }
    }
  }
  // Reading a page sideways or upside down yields plenty of words, but none the engine is sure of.
  const mean = confidences.reduce((sum, c) => sum + c, 0) / (confidences.length || 1)
  return { rotation, lines: mean < MIN_PAGE_CONFIDENCE ? [] : lines }
}

function lineConfidence({ confidence, words }: RawLine): number {
  return confidence ?? words.reduce((sum, w) => sum + w.confidence, 0) / (words.length || 1)
}

function toWord(w: RawLine['words'][number], line: RawLine, scale: number, size: PageSize, rotation: Rotation): OcrWord | null {
  const text = w.text.trim()
  const { x0, y0, x1, y1 } = w.bbox
  if (!text || w.confidence < MIN_WORD_CONFIDENCE || x1 <= x0 || y1 <= y0) return null
  const band = lineBand(line, w.bbox)
  const read: Rect = { x: x0 / scale, y: band.top / scale, w: (x1 - x0) / scale, h: (band.bottom - band.top) / scale }
  const { x, y, w: width, h } = fromReadingRect(read, size, rotation)
  return { text, x: round(x), y: round(y), w: round(width), h: round(h) }
}

/**
 * The line's band at the word: baseline (sloped on skewed scans) up to the top of capitals and
 * down to the bottom of descenders. A word's own box would make words of one line differ in height.
 */
function lineBand(line: RawLine, bbox: { y0: number; y1: number; x0: number; x1: number }): { top: number; bottom: number } {
  const own = { top: bbox.y0, bottom: bbox.y1 }
  const { baseline: b, rowAttributes: row } = line
  if (!b || !row || row.rowHeight <= 0 || b.x1 <= b.x0) return own
  const centre = (bbox.x0 + bbox.x1) / 2
  const base = b.y0 + ((b.y1 - b.y0) * (centre - b.x0)) / (b.x1 - b.x0)
  const top = base - (row.rowHeight - row.descenders)
  const bottom = base + row.descenders
  // A baseline from a different line (broken layout analysis) would put the band beside the word.
  const height = bbox.y1 - bbox.y0
  return Math.abs((top + bottom) / 2 - (bbox.y0 + bbox.y1) / 2) > height ? own : { top, bottom }
}

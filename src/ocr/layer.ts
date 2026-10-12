import { rotationTransform } from '../model/annotations'
import { readingLines, type OcrPage, type OcrWord } from '../model/ocr'
import { normalizeRotation, rotatedSize } from '../model/pages'
import type { PageSize, Rotation } from '../model/types'
import { keepSelecting } from './selection'

const FONT = 'Helvetica, Arial, sans-serif'

/** Width of a text in em, as the layer's font draws it. */
export type Measure = (text: string) => number

export interface Placed {
  word: OcrWord
  /** Left edge and top of the word box in the layer, in points. */
  x: number
  y: number
  /** The font size in points: the height of the box. */
  size: number
  /** Stretch that makes the word's natural width the width of its box. */
  stretch: number
}

/** Where each word goes in a layer that shows the page as it was read, with the width fitted word by word. */
export function placeWords(page: OcrPage, size: PageSize, measure: Measure): Placed[][] {
  return readingLines(page, size).map((line) =>
    line.words.map((word) => {
      const natural = measure(word.text) * word.h
      return { word, x: word.x, y: word.y, size: word.h, stretch: natural > 0 ? word.w / natural : 1 }
    }),
  )
}

function measurer(): Measure {
  const context = document.createElement('canvas').getContext('2d')!
  context.font = `100px ${FONT}`
  return (text) => context.measureText(text).width / 100
}

/**
 * Renders recognised text over a page as an invisible, selectable layer like pdf.js's. The layer
 * is laid out in the page as it was read and turned to the page's current orientation.
 * Returns the spans grouped by line: the words of a line read as one string when searching.
 */
export function renderOcrLayer(
  container: HTMLDivElement,
  page: OcrPage,
  size: PageSize,
  rotation: Rotation,
  cssWidth: number,
): HTMLElement[][] {
  const read = rotatedSize(size, page.rotation)
  const scale = cssWidth / rotatedSize(size, rotation).width
  const layer = document.createElement('div')
  layer.className = 'textLayer ocr-layer'
  layer.style.setProperty('--total-scale-factor', String(scale))
  layer.style.width = `${read.width * scale}px`
  layer.style.height = `${read.height * scale}px`
  layer.style.transform = rotationTransform(read, normalizeRotation(rotation - page.rotation), scale)

  const lines: HTMLElement[][] = []
  for (const line of placeWords(page, size, measurer())) {
    const spans = line.map(({ word, x, y, size: fontSize, stretch }, i) => {
      const span = document.createElement('span')
      // The space belongs to the word: copied text reads in words, and matchPieces reads a line as its spans joined.
      span.textContent = i < line.length - 1 ? `${word.text} ` : word.text
      span.style.left = `${x * scale}px`
      span.style.top = `${y * scale}px`
      span.style.setProperty('--font-height', `${fontSize}px`)
      span.style.setProperty('--scale-x', String(stretch))
      return span
    })
    layer.append(...spans, document.createElement('br'))
    lines.push(spans)
  }
  const end = document.createElement('div')
  end.className = 'endOfContent'
  layer.append(end)
  keepSelecting(layer, end)
  container.replaceChildren(layer)
  return lines
}

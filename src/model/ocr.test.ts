import { describe, expect, it } from 'vitest'
import { toPageSpace } from './annotations'
import {
  fromReadingRect,
  hasMeaningfulText,
  ocrStrings,
  pageFromRecognition,
  readingLines,
  toReadingRect,
  toReadingSpace,
  type OcrPage,
  type RawBlock,
  type RawLine,
} from './ocr'
import type { PageSize, Point, Rotation } from './types'

const size: PageSize = { width: 200, height: 300 }
const rotations: Rotation[] = [0, 90, 180, 270]

const block = (...lines: RawLine[]): RawBlock[] => [{ paragraphs: [{ lines }] }]
const word = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } })

describe('hasMeaningfulText', () => {
  it('treats a page number or a stamp as no text', () => {
    expect(hasMeaningfulText([])).toBe(false)
    expect(hasMeaningfulText(['Seite 3', ' ', '— 12 —'])).toBe(false)
  })
  it('counts letters and digits across items, in any script', () => {
    expect(hasMeaningfulText(['Sehr geehrte Frau Müller,', 'vielen Dank'])).toBe(true)
    expect(hasMeaningfulText(['東京都千代田区千代田一丁目一番地', '株式会社サンプル'])).toBe(true)
    expect(hasMeaningfulText(['1234567890', '1234567890'])).toBe(true)
    expect(hasMeaningfulText(['..........', '!!!!!!!!!!', '----------'])).toBe(false)
  })
})

describe('reading space', () => {
  it('undoes toPageSpace for every rotation', () => {
    const points: Point[] = [[0, 0], [10, 20], [199, 299], [100, 150]]
    for (const rotation of rotations) {
      for (const p of points) expect(toPageSpace(toReadingSpace(p, size, rotation), size, rotation)).toEqual(p)
    }
  })
  it('turns a page the way the user turned it', () => {
    // Top left of the page ends up top right when the page is turned right.
    expect(toReadingSpace([0, 0], size, 90)).toEqual([300, 0])
    expect(toReadingSpace([0, 0], size, 180)).toEqual([200, 300])
    expect(toReadingSpace([0, 0], size, 270)).toEqual([0, 200])
  })
  it('converts boxes both ways', () => {
    const box = { x: 10, y: 20, w: 50, h: 12 }
    for (const rotation of rotations) {
      const there = toReadingRect(box, size, rotation)
      expect(there.w * there.h).toBeCloseTo(box.w * box.h)
      expect(fromReadingRect(there, size, rotation)).toEqual(box)
    }
    expect(toReadingRect(box, size, 90)).toEqual({ x: 268, y: 10, w: 12, h: 50 })
  })
})

describe('pageFromRecognition', () => {
  it('scales pixels to points and keeps the lines', () => {
    const page = pageFromRecognition(block({ words: [word('Hallo', 80, 120, 200, 160), word('Welt', 240, 120, 340, 160)] }), 4, size, 0)
    expect(page).toEqual({
      rotation: 0,
      lines: [{ words: [{ text: 'Hallo', x: 20, y: 30, w: 30, h: 10 }, { text: 'Welt', x: 60, y: 30, w: 25, h: 10 }] }],
    })
  })

  it('gives words of a line the line band, following a sloped baseline', () => {
    const line: RawLine = {
      words: [word('links', 100, 100, 200, 140), word('rechts', 900, 90, 1000, 125)],
      baseline: { x0: 100, y0: 140, x1: 1000, y1: 125 },
      rowAttributes: { rowHeight: 40, descenders: 10 },
    }
    const [left, right] = pageFromRecognition(block(line), 1, { width: 2000, height: 3000 }, 0).lines[0].words
    // The band is 40 tall with 10 below the baseline, which rises 15 over 900 pixels: at the word centres 139.17 and 125.83.
    expect(left.h).toBe(40)
    expect(left.y).toBeCloseTo(139.17 - 30, 1)
    expect(right.y).toBeCloseTo(125.83 - 30, 1)
  })

  it('falls back to the word box without usable line data, or when the baseline belongs elsewhere', () => {
    const odd: RawLine = {
      words: [word('x', 10, 100, 50, 130)],
      baseline: { x0: 0, y0: 900, x1: 100, y1: 900 },
      rowAttributes: { rowHeight: 40, descenders: 10 },
    }
    const plain: RawLine = { words: [word('y', 10, 100, 50, 130)] }
    expect(pageFromRecognition(block(odd, plain), 1, size, 0).lines.map((l) => [l.words[0].y, l.words[0].h])).toEqual([[100, 30], [100, 30]])
  })

  it('drops words and lines the engine doubts, and empty ones', () => {
    const noise: RawLine = { confidence: 8, words: [word('ER', 0, 0, 50, 20, 90), word('Sige', 60, 0, 120, 20, 90)] }
    const mixed: RawLine = { words: [word('gut', 0, 40, 50, 60, 95), word('?', 60, 40, 70, 60, 12), word('  ', 80, 40, 90, 60, 95), word('flach', 100, 40, 100, 60, 95)] }
    expect(ocrStrings(pageFromRecognition(block(noise, mixed), 1, size, 0))).toEqual(['gut'])
    expect(pageFromRecognition(null, 1, size, 0).lines).toEqual([])
  })

  it('keeps nothing from a page the engine is unsure about throughout, like one read sideways', () => {
    const sure = (text: string, x: number) => word(text, x, 0, x + 40, 20, 92)
    const unsure = (text: string, x: number) => word(text, x, 0, x + 40, 20, 62)
    const page = (w: typeof sure) => pageFromRecognition(block({ words: [w('ab', 0), w('cd', 50), w('ef', 100)] }), 1, size, 0)
    expect(page(sure).lines).toHaveLength(1)
    expect(page(unsure)).toEqual({ rotation: 0, lines: [] })
  })

  it('stores boxes in page space for a page that was turned when it was read', () => {
    // Read after turning right: the reading page is 300 wide and 200 tall.
    const page = pageFromRecognition(block({ words: [word('Quer', 20, 40, 100, 60)] }), 2, size, 90)
    expect(page.rotation).toBe(90)
    expect(page.lines[0].words[0]).toEqual({ text: 'Quer', x: 20, y: 250, w: 10, h: 40 })
    // And back in the reading page it is where the engine saw it.
    expect(readingLines(page, size)[0].words[0]).toMatchObject({ x: 10, y: 20, w: 40, h: 10 })
  })
})

describe('ocrStrings', () => {
  it('gives one string per line', () => {
    const page: OcrPage = { rotation: 0, lines: [{ words: [{ text: 'a', x: 0, y: 0, w: 1, h: 1 }, { text: 'b', x: 2, y: 0, w: 1, h: 1 }] }, { words: [{ text: 'c', x: 0, y: 5, w: 1, h: 1 }] }] }
    expect(ocrStrings(page)).toEqual(['a b', 'c'])
  })
})

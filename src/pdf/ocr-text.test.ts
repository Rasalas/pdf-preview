import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { visibleRect } from '../model/crop'
import { fromReadingRect, toReadingSpace, type OcrPage } from '../model/ocr'
import { normalizeRotation, rotatedSize } from '../model/pages'
import type { Page, PageSize, Rect, Rotation, Source } from '../model/types'
import { buildPdf } from './export'
import { squeeze, wordMatrix } from './ocr-text'

const rotations: Rotation[] = [0, 90, 180, 270]
const size: PageSize = { width: 200, height: 300 }

describe('wordMatrix', () => {
  const read = { x: 10, y: 20, w: 50, h: 10 }

  it('puts the baseline start of upright text on the page, y up', () => {
    // The baseline is 80 % down the box: 28 from the top, 272 from the bottom.
    expect(wordMatrix(read, 0, size)).toEqual([1, 0, 0, 1, 10, 272])
  })

  it('turns text that was read after turning the page', () => {
    // Read after turning right: the text runs up the page.
    expect(wordMatrix(read, 90, size)).toEqual([0, 1, -1, 0, 28, 10])
    expect(wordMatrix(read, 180, size).slice(0, 4)).toEqual([-1, 0, 0, -1])
    expect(wordMatrix(read, 270, size).slice(0, 4)).toEqual([0, -1, 1, 0])
  })
})

describe('squeeze', () => {
  it('scales text to its box and keeps within what viewers cope with', () => {
    expect(squeeze(50, 40)).toBe(125)
    expect(squeeze(1, 100)).toBe(10)
    expect(squeeze(1000, 1)).toBe(1000)
    expect(squeeze(10, 0)).toBe(100)
  })
})

const blank = (id: string): Source => ({ id, name: id, kind: 'blank', mime: null, bytes: null, pages: [size] })

/** A page that was read after turning it by `rotation`, with one word in `read`, a box in the page as it was read. */
function readPage(page: PageSize, rotation: Rotation, text: string, read: Rect): OcrPage {
  return { rotation, lines: [{ words: [{ text, ...fromReadingRect(read, page, rotation) }] }] }
}

/** Where a point of the page as it was read lands in the page as displayed after turning it by `turn`. */
function displayed(p: { x: number; y: number }, page: PageSize, readAt: Rotation, turn: Rotation) {
  const inPage = fromReadingRect({ ...p, w: 0, h: 0 }, page, readAt)
  return toReadingSpace([inPage.x, inPage.y], page, turn)
}

async function pdfjsPage(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  return doc.getPage(1)
}

type TextItem = { str: string; transform: number[]; width: number }
const textItems = async (page: Awaited<ReturnType<typeof pdfjsPage>>) =>
  (await page.getTextContent()).items.filter((i): i is typeof i & TextItem => 'str' in i && i.str.trim() !== '')

describe('buildPdf with recognised text', () => {
  const box = { x: 20, y: 30, w: 50, h: 10 }

  it('writes the text invisibly, where it was read, whichever way the page was and is turned', async () => {
    const issues: string[] = []
    for (const readAt of rotations) {
      for (const turn of rotations) {
        const label = `read at ${readAt}, shown at ${turn}`
        const ocr = { b: { 0: readPage(size, readAt, 'Hallo', box) } }
        const pages: Page[] = [{ id: 'p', sourceId: 'b', index: 0, rotation: turn }]
        const page = await pdfjsPage(await buildPdf(pages, { b: blank('b') }, 'T', undefined, { ocr }))
        const [item] = await textItems(page)
        if (item?.str !== 'Hallo') {
          issues.push(`${label}: found ${item?.str}`)
          continue
        }
        const viewport = page.getViewport({ scale: 1 })
        const [e, f] = [item.transform[4], item.transform[5]]
        const at = viewport.convertToViewportPoint(e, f)
        const along = viewport.convertToViewportPoint(e + item.transform[0], f + item.transform[1])
        // Where the word starts, and which way it runs, in the page as displayed.
        const expected = displayed({ x: box.x, y: box.y + box.h * 0.8 }, size, readAt, turn)
        const direction = [[1, 0], [0, 1], [-1, 0], [0, -1]][normalizeRotation(turn - readAt) / 90]
        if (Math.abs(at[0] - expected[0]) > 0.2 || Math.abs(at[1] - expected[1]) > 0.2) issues.push(`${label}: starts at ${at}, expected ${expected}`)
        const length = Math.hypot(along[0] - at[0], along[1] - at[1])
        if (Math.abs((along[0] - at[0]) / length - direction[0]) > 0.01 || Math.abs((along[1] - at[1]) / length - direction[1]) > 0.01) issues.push(`${label}: runs ${[along[0] - at[0], along[1] - at[1]]}`)
        if (Math.abs(item.width - box.w) > 0.5) issues.push(`${label}: ${item.width} wide, expected ${box.w}`)
        const shown = rotatedSize(size, turn)
        if (viewport.width !== shown.width || viewport.height !== shown.height) issues.push(`${label}: page is ${viewport.width} x ${viewport.height}`)
      }
    }
    expect(issues).toEqual([])
  }, 120_000)

  it('also works on pages with their own /Rotate, next to the page content', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 300])
    page.drawText('Original', { x: 10, y: 10, font: await doc.embedFont(StandardFonts.Helvetica) })
    page.setRotation(degrees(90))
    // The page as displayed with its own /Rotate is 300 x 200.
    const own = { width: 300, height: 200 }
    const source: Source = { id: 'r', name: 'r', kind: 'pdf', mime: 'application/pdf', bytes: await doc.save(), pages: [own] }
    const ocr = { r: { 0: readPage(own, 0, 'Gelesen', { x: 30, y: 40, w: 60, h: 12 }) } }
    const pages: Page[] = [{ id: 'p', sourceId: 'r', index: 0, rotation: 90 }]
    const out = await pdfjsPage(await buildPdf(pages, { r: source }, 'T', undefined, { ocr }))
    const items = await textItems(out)
    expect(items.map((i) => i.str)).toEqual(expect.arrayContaining(['Original', 'Gelesen']))
    const item = items.find((i) => i.str === 'Gelesen')!
    const at = out.getViewport({ scale: 1 }).convertToViewportPoint(item.transform[4], item.transform[5])
    const expected = displayed({ x: 30, y: 40 + 12 * 0.8 }, own, 0, 90)
    expect(at[0]).toBeCloseTo(expected[0], 1)
    expect(at[1]).toBeCloseTo(expected[1], 1)
  })

  it('keeps words where they are on a cropped page and leaves out the ones cropped away', async () => {
    const crop = { x: 100, y: 120, w: 90, h: 100 }
    for (const turn of [0, 90, 270] as Rotation[]) {
      const read = (text: string, x: number, y: number) => readPage(size, 0, text, { x, y, w: 40, h: 10 }).lines[0].words[0]
      const ocr: OcrPage = { rotation: 0, lines: [{ words: [read('Weg', 20, 30), read('Bleibt', 110, 150)] }] }
      const pages: Page[] = [{ id: 'p', sourceId: 'b', index: 0, rotation: turn, crop }]
      const page = await pdfjsPage(await buildPdf(pages, { b: blank('b') }, 'T', undefined, { ocr: { b: { 0: ocr } } }))
      const items = await textItems(page)
      expect(items.map((i) => i.str)).toEqual(['Bleibt'])
      // The crop moves the page's corner, not the text on it.
      const shown = visibleRect(size, { rotation: turn, crop })
      const at = page.getViewport({ scale: 1 }).convertToViewportPoint(items[0].transform[4], items[0].transform[5])
      const expected = displayed({ x: 110, y: 150 + 10 * 0.8 }, size, 0, turn)
      expect(at[0]).toBeCloseTo(expected[0] - shown.x, 1)
      expect(at[1]).toBeCloseTo(expected[1] - shown.y, 1)
    }
  })

  it('keeps the words of a line together for searching, and replaces what the font cannot encode', async () => {
    const words = ['Sehr', 'geehrte', 'Фрау', 'Weiß'].map((text, i) => ({ text, x: 10 + i * 30, y: 20, w: 26, h: 10 }))
    const ocr: OcrPage = { rotation: 0, lines: [{ words }] }
    const pages: Page[] = [{ id: 'p', sourceId: 'b', index: 0, rotation: 0 }]
    const page = await pdfjsPage(await buildPdf(pages, { b: blank('b') }, 'T', undefined, { ocr: { b: { 0: ocr } } }))
    const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    expect(text.replace(/\s+/g, ' ').trim()).toBe('Sehr geehrte ???? Weiß')
  })

  it('leaves pages without recognised text as they were', async () => {
    const pages: Page[] = [{ id: 'p', sourceId: 'b', index: 0, rotation: 0 }]
    const shape = async (options?: Parameters<typeof buildPdf>[4]) => {
      const page = (await PDFDocument.load(await buildPdf(pages, { b: blank('b') }, 'T', undefined, options))).getPage(0)
      return { fonts: page.node.Resources()?.has(PDFName.of('Font')) ?? false, content: page.node.Contents() !== undefined }
    }
    const without = await shape()
    expect(without).toEqual({ fonts: false, content: false })
    expect(await shape({ ocr: {} })).toEqual(without)
    expect(await shape({ ocr: { other: { 0: { rotation: 0, lines: [{ words: [{ text: 'x', x: 0, y: 0, w: 1, h: 1 }] }] } } } })).toEqual(without)
    expect(await shape({ ocr: { b: { 0: { rotation: 0, lines: [] } } } })).toEqual(without)
  })
})

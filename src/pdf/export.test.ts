import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Page, Source } from '../model/types'
import { buildPdf } from './export'

async function makePdf(labels: string[], rotate = 0) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of labels) {
    const page = doc.addPage([200, 300])
    page.drawText(label, { x: 10, y: 10, font })
    page.setRotation({ type: 'degrees', angle: rotate } as never)
  }
  return doc.save()
}

const pdfSource = async (id: string, labels: string[], rotate = 0): Promise<Source> => ({
  id,
  name: id,
  kind: 'pdf',
  mime: 'application/pdf',
  bytes: await makePdf(labels, rotate),
  pages: labels.map(() => ({ width: 200, height: 300 })),
})

describe('buildPdf', () => {
  it('combines, reorders, duplicates and rotates pages from several files', async () => {
    const a = await pdfSource('a', ['A1', 'A2'])
    const b = await pdfSource('b', ['B1'], 90)
    const blank: Source = { id: 'c', name: '', kind: 'blank', mime: null, bytes: null, pages: [{ width: 100, height: 50 }] }
    const pages: Page[] = [
      { id: '1', sourceId: 'b', index: 0, rotation: 90 },
      { id: '2', sourceId: 'a', index: 1, rotation: 0 },
      { id: '3', sourceId: 'a', index: 1, rotation: 270 },
      { id: '4', sourceId: 'c', index: 0, rotation: 0 },
    ]

    const out = await PDFDocument.load(await buildPdf(pages, { a, b, c: blank }, 'Test'))

    expect(out.getPageCount()).toBe(4)
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([180, 0, 270, 0])
    expect(out.getPage(3).getSize()).toEqual({ width: 100, height: 50 })
    expect(out.getTitle()).toBe('Test')
    // Duplicated pages must be distinct objects, or viewers show only one.
    expect(out.getPage(1).ref).not.toEqual(out.getPage(2).ref)
  })
})

describe('buildPdf with annotations', () => {
  it('flattens every annotation type, also on pages with their own /Rotate', async () => {
    const a = await pdfSource('rotated', ['A1'], 90)
    const pages: Page[] = [
      {
        id: '1',
        sourceId: 'rotated',
        index: 0,
        rotation: 90,
        annotations: [
          { id: 'h', type: 'highlight', color: '#ffd400', rects: [{ x: 1, y: 1, w: 50, h: 10 }] },
          { id: 'r', type: 'rect', color: '#ff0000', width: 2, x: 10, y: 10, w: 50, h: 30 },
          { id: 'e', type: 'ellipse', color: '#0000ff', width: 2, x: 10, y: 10, w: 50, h: 30 },
          { id: 'l', type: 'line', color: '#000000', width: 2, arrow: true, p1: [0, 0], p2: [40, 40] },
          { id: 'i', type: 'ink', color: '#000000', width: 2, paths: [[[0, 0], [5, 5], [9, 2]], [[3, 3]]] },
          { id: 'n', type: 'ink', nib: true, color: '#000000', width: 2, paths: [[[0, 0], [5, 5], [9, 2]], [[3, 3]]], pressures: [[0.2, 0.5, 0.8], [0.5]] },
          { id: 't', type: 'text', color: '#000000', size: 12, x: 10, y: 100, text: 'Grüße\n€ 5 ✓' },
        ],
      },
    ]
    const out = await PDFDocument.load(await buildPdf(pages, { rotated: a }, 'Annotiert'))
    expect(out.getPage(0).getRotation().angle).toBe(180)
    expect(out.getPage(0).node.Contents()).toBeDefined()
  })
})

describe('buildPdf with laid-on pages', () => {
  it('draws a turned, cropped page from another file into its box', async () => {
    const a = await pdfSource('a', ['A1'], 90)
    const sheet: Source = { id: 's', name: '', kind: 'blank', mime: null, bytes: null, pages: [{ width: 595, height: 842 }] }
    const laid: Page = { id: 'x', sourceId: 'a', index: 0, rotation: 90, crop: { x: 0, y: 0, w: 150, h: 100 } }
    const pages: Page[] = [{ id: '1', sourceId: 's', index: 0, rotation: 0, annotations: [{ id: 'p', type: 'page', page: laid, x: 50, y: 50, w: 100, h: 150 }] }]
    const out = await PDFDocument.load(await buildPdf(pages, { a, s: sheet }, 'Blatt'))
    expect(out.getPageCount()).toBe(1)
    expect(out.getPage(0).getSize()).toEqual({ width: 595, height: 842 })
    // The laid-on page arrives as a form XObject.
    expect(out.getPage(0).node.Resources()?.toString()).toContain('XObject')
  })
})

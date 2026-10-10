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

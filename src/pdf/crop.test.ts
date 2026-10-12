import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Page, Rect, Rotation, Source } from '../model/types'
import { buildPdf, type BuildOptions } from './export'

interface Options {
  rotate?: number
  cropBox?: [number, number, number, number]
}

async function makePdf(count: number, { rotate = 0, cropBox }: Options = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([200, 300])
    page.drawText(`Seite ${i + 1}`, { x: 10, y: 10, font })
    if (cropBox) page.setCropBox(...cropBox)
    page.setRotation(degrees(rotate))
  }
  return doc.save()
}

// buildPdf caches the loaded document by source id, so every source needs an id of its own.
let serial = 0
const sourceId = () => `s${++serial}`

async function pdfSource(count = 1, options: Options = {}, size = { width: 200, height: 300 }): Promise<Source> {
  return { id: sourceId(), name: 'a.pdf', kind: 'pdf', mime: 'application/pdf', bytes: await makePdf(count, options), pages: Array.from({ length: count }, () => size) }
}

const entry = (source: Source, index = 0, extra: Partial<Page> = {}): Page => ({ id: `p${++serial}`, sourceId: source.id, index, rotation: 0, ...extra })

async function exportPages(pages: Page[], sources: Source[], options?: BuildOptions) {
  return PDFDocument.load(await buildPdf(pages, Object.fromEntries(sources.map((s) => [s.id, s])), 'T', undefined, options))
}

const box = (doc: PDFDocument, i: number) => doc.getPage(i).getCropBox()
const crop = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

function contentOf(doc: PDFDocument, index: number) {
  const contents = doc.getPage(index).node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents]
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n')
}

describe('crop in the exported PDF', () => {
  it('narrows the CropBox of a page and leaves the content and other pages alone', async () => {
    const a = await pdfSource(2)
    const out = await exportPages([entry(a, 0, { crop: crop(20, 30, 100, 150) }), entry(a, 1)], [a])
    expect(box(out, 0)).toEqual({ x: 20, y: 120, width: 100, height: 150 })
    expect(out.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 200, height: 300 })
    // "Seite 1" as the hex string pdf-lib writes.
    expect(contentOf(out, 0)).toContain('<53656974652031>')
    expect(out.getPage(1).node.CropBox()).toBeUndefined()
  })

  it('gives copies of one page their own crop', async () => {
    const a = await pdfSource()
    const out = await exportPages([entry(a, 0, { crop: crop(0, 0, 100, 100) }), entry(a, 0, { crop: crop(100, 200, 100, 100) }), entry(a)], [a])
    expect([box(out, 0), box(out, 1)]).toEqual([
      { x: 0, y: 200, width: 100, height: 100 },
      { x: 100, y: 0, width: 100, height: 100 },
    ])
    expect(out.getPage(2).node.CropBox()).toBeUndefined()
  })

  // /Rotate 90 shows the 200 x 300 page as 300 x 200; the user's rotation comes on top and does not move the crop.
  it.each<Rotation>([0, 90, 180, 270])('keeps a crop on a page with its own /Rotate when the user turns it by %i°', async (rotation) => {
    const a = await pdfSource(1, { rotate: 90 }, { width: 300, height: 200 })
    const out = await exportPages([entry(a, 0, { rotation, crop: crop(10, 20, 100, 50) })], [a])
    expect(box(out, 0)).toEqual({ x: 20, y: 10, width: 50, height: 100 })
    expect(out.getPage(0).getRotation().angle).toBe((90 + rotation) % 360)
  })

  it('measures from an existing CropBox', async () => {
    const a = await pdfSource(1, { cropBox: [10, 20, 180, 260] }, { width: 180, height: 260 })
    const out = await exportPages([entry(a, 0, { crop: crop(20, 30, 100, 100) })], [a])
    expect(box(out, 0)).toEqual({ x: 30, y: 150, width: 100, height: 100 })
    expect(out.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 200, height: 300 })
  })

  it('draws annotations where they were placed, then crops', async () => {
    const a = await pdfSource(1, { cropBox: [10, 20, 180, 260] }, { width: 180, height: 260 })
    const annotations: Page['annotations'] = [{ id: 'r', type: 'rect', color: '#ff0000', width: 2, x: 30, y: 40, w: 20, h: 10 }]
    const out = await exportPages([entry(a, 0, { annotations, crop: crop(20, 30, 100, 100) })], [a])
    // The matrix still starts at the original box, not the cropped one.
    expect(contentOf(out, 0)).toContain('1 0 0 1 10 20 cm')
    expect(box(out, 0)).toEqual({ x: 30, y: 150, width: 100, height: 100 })
  })

  it('crops blank pages, also when compressing', async () => {
    const blank: Source = { id: sourceId(), name: '', kind: 'blank', mime: null, bytes: null, pages: [{ width: 100, height: 50 }] }
    const out = await exportPages([entry(blank, 0, { rotation: 90, crop: crop(10, 0, 40, 50) })], [blank], { compress: true, onCompressed: () => {} })
    expect(box(out, 0)).toEqual({ x: 10, y: 0, width: 40, height: 50 })
  })

  it('crops an image page', async () => {
    // Smallest byte sequence pdf-lib accepts as a JPEG.
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 30, 0, 40, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9)
    const image: Source = { id: sourceId(), name: 'i.jpg', kind: 'image', mime: 'image/jpeg', bytes, pages: [{ width: 200, height: 150 }] }
    const out = await exportPages([entry(image, 0, { crop: crop(20, 10, 100, 100) })], [image])
    expect(box(out, 0)).toEqual({ x: 20, y: 40, width: 100, height: 100 })
  })

  it('crops a page whose form was flattened', async () => {
    const doc = await PDFDocument.create()
    doc.getForm().createTextField('name').addToPage(doc.addPage([300, 400]), { x: 10, y: 350, width: 120, height: 20 })
    const form: Source = { id: sourceId(), name: 'f.pdf', kind: 'pdf', mime: 'application/pdf', bytes: await doc.save(), pages: [{ width: 300, height: 400 }] }
    const out = await exportPages([entry(form, 0, { crop: crop(0, 0, 150, 100) })], [form], { fields: { [form.id]: { name: 'Anna' } } })
    expect(out.getForm().getFields()).toHaveLength(0)
    expect(box(out, 0)).toEqual({ x: 0, y: 300, width: 150, height: 100 })
    expect(out.getPage(0).node.get(PDFName.of('CropBox'))).toBeDefined()
  })
})

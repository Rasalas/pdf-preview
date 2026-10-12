import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Page, Source } from '../model/types'
import { buildPdf } from './export'
import { encodePng, readPng } from './png'

/** Smallest byte sequence pdf-lib accepts as a JPEG: it only reads up to the frame header. */
function jpeg(width: number, height: number, orientation = 1) {
  const exif = [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0])
  const app1 = orientation === 1 ? [] : [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255, ...exif]
  return Uint8Array.of(0xff, 0xd8, ...app1, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9)
}

const imageSource = (id: string, mime: Source['mime'], bytes: Uint8Array, size: { width: number; height: number }): Source => ({
  id,
  name: id,
  kind: 'image',
  mime,
  bytes,
  pages: [size],
})

const page = (sourceId: string): Page => ({ id: sourceId, sourceId, index: 0, rotation: 0 })

function contentOf(doc: PDFDocument, index: number) {
  const node = doc.getPage(index).node
  const contents = node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents]
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n')
}

function imageDict(doc: PDFDocument, index: number) {
  const xobjects = doc.getPage(index).node.Resources()!.lookup(PDFName.of('XObject'))
  const ref = (xobjects as unknown as { values(): unknown[] }).values()[0]
  return doc.context.lookup(ref as never) as PDFStream
}

describe('image pages', () => {
  it('stretches an upright JPEG over the page', async () => {
    const source = imageSource('a', 'image/jpeg', jpeg(40, 30), { width: 200, height: 150 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    expect(contentOf(out, 0)).toMatch(/q\n200 0 0 150 0 0 cm\n\/Image[-\w]+ Do\nQ/)
  })

  it('draws a JPEG stored sideways upright, without touching its bytes', async () => {
    // Stored 40 x 30, displayed 30 x 40 (orientation 6, a phone held upright): page is 150 x 200.
    const bytes = jpeg(40, 30, 6)
    const source = imageSource('a', 'image/jpeg', bytes, { width: 150, height: 200 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    expect(out.getPage(0).getSize()).toEqual({ width: 150, height: 200 })
    expect(contentOf(out, 0)).toMatch(/q\n0 -200 150 0 0 200 cm\n/)
    const image = imageDict(out, 0) as PDFRawStream
    expect(image.getContents()).toEqual(bytes)
  })

  it('mirrors for the mirrored orientations', async () => {
    const source = imageSource('a', 'image/jpeg', jpeg(40, 30, 2), { width: 200, height: 150 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    expect(contentOf(out, 0)).toMatch(/q\n-200 0 0 150 200 0 cm\n/)
  })

  it('draws a PNG without turning it', async () => {
    const png = await encodePng({ width: 4, height: 2, depth: 8, colorType: 0, data: new Uint8Array(8).fill(9) })
    const source = imageSource('a', 'image/png', png, { width: 200, height: 100 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    expect(contentOf(out, 0)).toMatch(/q\n200 0 0 100 0 0 cm\n/)
  })

  it('still rotates the page after the image was turned', async () => {
    const source = imageSource('a', 'image/jpeg', jpeg(40, 30, 6), { width: 150, height: 200 })
    const rotated: Page = { ...page('a'), rotation: 90 }
    const out = await PDFDocument.load(await buildPdf([rotated], { a: source }, 'T'))
    expect(out.getPage(0).getRotation().angle).toBe(90)
    expect(contentOf(out, 0)).toMatch(/q\n0 -200 150 0 0 200 cm\n/)
  })

  it('embeds an opaque 1-bit PNG without expanding it', async () => {
    const png = await encodePng({ width: 64, height: 32, depth: 1, colorType: 0, data: new Uint8Array(8 * 32).fill(0xaa) })
    const source = imageSource('a', 'image/png', png, { width: 64, height: 32 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    const dict = imageDict(out, 0).dict
    expect(dict.get(PDFName.of('ColorSpace'))).toEqual(PDFName.of('DeviceGray'))
    expect(dict.get(PDFName.of('BitsPerComponent'))!.toString()).toBe('1')
  })

  it('keeps the compressed pixels of the PNG and its filter settings', async () => {
    const png = await encodePng({ width: 19, height: 6, depth: 1, colorType: 0, data: new Uint8Array(18).map((_, i) => i * 7) })
    const source = imageSource('a', 'image/png', png, { width: 19, height: 6 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    const image = imageDict(out, 0)
    expect((image as PDFRawStream).getContents()).toEqual(readPng(png)!.idat)
    const parms = image.dict.get(PDFName.of('DecodeParms'))!.toString()
    for (const entry of ['/Predictor 15', '/Colors 1', '/BitsPerComponent 1', '/Columns 19']) expect(parms).toContain(entry)
  })

  it('wraps palette PNGs in an Indexed colour space', async () => {
    const palette = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255)
    const png = await encodePng({ width: 3, height: 2, depth: 4, colorType: 3, data: Uint8Array.of(0x01, 0x20, 0x12, 0x00), palette })
    const source = imageSource('a', 'image/png', png, { width: 3, height: 2 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    expect(imageDict(out, 0).dict.get(PDFName.of('ColorSpace'))!.toString()).toBe('[ /Indexed /DeviceRGB 2 <ff000000ff000000ff> ]')
  })

  it('leaves PNGs with transparency to pdf-lib, keeping the alpha channel', async () => {
    const rgba = Uint8Array.from({ length: 4 * 4 * 4 }, (_, i) => (i % 4 === 3 ? 128 : i * 3))
    const png = await encodePng({ width: 4, height: 4, depth: 8, colorType: 6, data: rgba })
    const source = imageSource('a', 'image/png', png, { width: 4, height: 4 })
    const out = await PDFDocument.load(await buildPdf([page('a')], { a: source }, 'T'))
    expect(imageDict(out, 0).dict.get(PDFName.of('SMask'))).toBeDefined()
  })

  it('embeds an image once when several pages use it', async () => {
    const source = imageSource('a', 'image/jpeg', jpeg(40, 30), { width: 200, height: 150 })
    const pages = [page('a'), { ...page('a'), id: 'again' }]
    const out = await PDFDocument.load(await buildPdf(pages, { a: source }, 'T'))
    const images = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    expect(images).toHaveLength(1)
  })
})

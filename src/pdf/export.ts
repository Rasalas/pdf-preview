import { PDFDocument, degrees, type PDFImage } from 'pdf-lib'
import type { Page, Sources } from '../model/types'

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
  for (const [i, page] of pages.entries()) {
    const source = sources[page.sourceId]
    if (source.kind === 'pdf') {
      const pdfPage = out.addPage(copied.get(page)!)
      pdfPage.setRotation(degrees((pdfPage.getRotation().angle + page.rotation) % 360))
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
      pdfPage.setRotation(degrees(page.rotation))
    }
    onProgress?.(i + 1, pages.length)
  }
  return out.save()
}

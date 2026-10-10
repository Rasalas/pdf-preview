import { EncryptedPDFError } from 'pdf-lib'
import { newId } from '../model/ids'
import type { PageSize, Source } from '../model/types'
import { loadForExport } from './export'
import { openPdf } from './pdfjs'

export class ImportError extends Error {}

const PT_PER_PX = 72 / 96
// Images become pages at 96 dpi, shrunk so the long edge is at most A4's.
const MAX_IMAGE_EDGE = 842

export const ACCEPT = 'application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml'

export async function importFile(file: File): Promise<Source> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) return importPdf(file)
  if (file.type.startsWith('image/')) return importImage(file)
  throw new ImportError(`„${file.name}“ ist weder ein PDF noch ein Bild.`)
}

async function importPdf(file: File): Promise<Source> {
  const id = newId()
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    await loadForExport(id, bytes)
  } catch (e) {
    if (e instanceof EncryptedPDFError) {
      throw new ImportError(`„${file.name}“ ist verschlüsselt. Verschlüsselte PDFs werden noch nicht unterstützt.`)
    }
    throw new ImportError(`„${file.name}“ konnte nicht gelesen werden. Die Datei ist vielleicht beschädigt.`)
  }
  let doc
  try {
    doc = await openPdf({ id, bytes })
  } catch {
    throw new ImportError(`„${file.name}“ konnte nicht gelesen werden. Die Datei ist vielleicht beschädigt.`)
  }
  const pages: PageSize[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const { width, height } = (await doc.getPage(i)).getViewport({ scale: 1 })
    pages.push({ width, height })
  }
  if (pages.length === 0) throw new ImportError(`„${file.name}“ enthält keine Seiten.`)
  return { id, name: file.name, kind: 'pdf', mime: 'application/pdf', bytes, pages }
}

async function importImage(file: File): Promise<Source> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImportError(`Das Bild „${file.name}“ kann dieser Browser nicht öffnen.`)
  }
  const { width, height } = bitmap
  let mime = file.type as Source['mime']
  let bytes: Uint8Array
  if (mime === 'image/png' || mime === 'image/jpeg') {
    bytes = new Uint8Array(await file.arrayBuffer())
  } else {
    // PDF only embeds PNG and JPEG directly; convert everything else once, losslessly.
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    bytes = new Uint8Array(await blob!.arrayBuffer())
    mime = 'image/png'
  }
  bitmap.close()
  const scale = Math.min(PT_PER_PX, MAX_IMAGE_EDGE / Math.max(width, height))
  return {
    id: newId(),
    name: file.name,
    kind: 'image',
    mime,
    bytes,
    pages: [{ width: width * scale, height: height * scale }],
  }
}

export function blankSource(size: PageSize): Source {
  return { id: newId(), name: 'Leere Seite', kind: 'blank', mime: null, bytes: null, pages: [size] }
}

export const A4: PageSize = { width: 595.28, height: 841.89 }

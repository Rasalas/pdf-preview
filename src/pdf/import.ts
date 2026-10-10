import { newId } from '../model/ids'
import type { PageSize, Source } from '../model/types'
import { openPdf } from './pdfjs'

export class ImportError extends Error {}

const PT_PER_PX = 72 / 96
// Images become pages at 96 dpi, shrunk so the long edge is at most A4's.
const MAX_IMAGE_EDGE = 842

export const ACCEPT = 'application/pdf,.pdf,image/*,.heic,.heif'

// Some systems hand over files without a MIME type, so the extension counts too.
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
}

export async function importFile(file: File): Promise<Source> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type === 'application/pdf' || ext === 'pdf') return importPdf(file)
  const type = file.type.startsWith('image/') ? file.type : IMAGE_TYPES[ext]
  if (type) return importImage(file, type)
  if (file.size === 0 && !file.type) throw new ImportError(`„${file.name}“ ist ein Ordner oder leer. Bitte die Dateien darin auswählen.`)
  throw new ImportError(`„${file.name}“ ist weder ein PDF noch ein Bild.`)
}

async function importPdf(file: File): Promise<Source> {
  const id = newId()
  const bytes = new Uint8Array(await file.arrayBuffer())
  // pdf-lib must be able to read the file, or it could not be exported later.
  const { loadForExport, EncryptedPDFError } = await import('./export')
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

async function importImage(file: File, type: string): Promise<Source> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    if (/hei[cf]/.test(type)) {
      throw new ImportError(
        `„${file.name}“ ist ein HEIC-Foto, das dieser Browser nicht öffnen kann. In Safari klappt es, sonst das Foto vorher als JPEG exportieren.`,
      )
    }
    throw new ImportError(`Das Bild „${file.name}“ kann dieser Browser nicht öffnen.`)
  }
  const { width, height } = bitmap
  let bytes = new Uint8Array(await file.arrayBuffer())
  // Trust the content, not the name: a PNG called .jpg would otherwise fail at export.
  let mime = sniffImage(bytes)
  if (!mime) {
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

export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

export function blankSource(size: PageSize): Source {
  return { id: newId(), name: 'Leere Seite', kind: 'blank', mime: null, bytes: null, pages: [size] }
}

export const A4: PageSize = { width: 595.28, height: 841.89 }

import { newId } from '../model/ids'
import type { PageSize, Source } from '../model/types'
import { ImportError } from './errors'
import { importImage } from './image-import'
import { openPdf } from './pdfjs'

export { ImportError }

export const ACCEPT = 'application/pdf,.pdf,image/*,.heic,.heif,.tif,.tiff,.svg'

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
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
}

/** Most files make one source; a TIFF makes one per page. */
export async function importFile(file: File): Promise<Source[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type === 'application/pdf' || ext === 'pdf') return [await importPdf(file)]
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

export function blankSource(size: PageSize): Source {
  return { id: newId(), name: 'Leere Seite', kind: 'blank', mime: null, bytes: null, pages: [size] }
}

export const A4: PageSize = { width: 595.28, height: 841.89 }

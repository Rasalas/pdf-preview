import { newId } from '../model/ids'
import type { PageSize, Source } from '../model/types'
import { PasswordError, UnsupportedEncryptionError, decryptPdf } from './decrypt'
import { ImportError } from './errors'
import { importImage } from './image-import'
import { openPdf } from './pdfjs'

export { ImportError }

export interface ImportOptions {
  /** Resolves with the password, or null when the user skips the file. */
  askPassword?: (request: { name: string; wrong: boolean }) => Promise<string | null>
  /** Passes on something the user should know about a file. */
  notify?: (text: string) => void
}

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

/** Most files make one source, a TIFF one per page, and a skipped password-protected PDF none. */
export async function importFile(file: File, options: ImportOptions = {}): Promise<Source[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type === 'application/pdf' || ext === 'pdf') {
    const source = await importPdf(file, options)
    return source ? [source] : []
  }
  const type = file.type.startsWith('image/') ? file.type : IMAGE_TYPES[ext]
  if (type) return importImage(file, type)
  if (file.size === 0 && !file.type) throw new ImportError(`„${file.name}“ ist ein Ordner oder leer. Bitte die Dateien darin auswählen.`)
  throw new ImportError(`„${file.name}“ ist weder ein PDF noch ein Bild.`)
}

const unreadable = (file: File) => new ImportError(`„${file.name}“ konnte nicht gelesen werden. Die Datei ist vielleicht beschädigt.`)

async function importPdf(file: File, options: ImportOptions): Promise<Source | null> {
  const id = newId()
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer())
  // pdf-lib must be able to read the file, or it could not be exported later.
  const { loadForExport, isEncryptedError } = await import('./export')
  let parsed
  try {
    parsed = await loadForExport(id, bytes)
  } catch (e) {
    if (!isEncryptedError(e)) throw unreadable(file)
    // From here on the source holds the decrypted bytes, so everything else works as for any PDF.
    const plain = await unlock(file, bytes, options)
    if (!plain) return null
    bytes = plain
    try {
      parsed = await loadForExport(id, bytes)
    } catch {
      throw unreadable(file)
    }
  }
  let doc
  try {
    doc = await openPdf({ id, bytes })
  } catch {
    throw unreadable(file)
  }
  const pages: PageSize[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const { width, height } = (await doc.getPage(i)).getViewport({ scale: 1 })
    pages.push({ width, height })
  }
  if (pages.length === 0) throw new ImportError(`„${file.name}“ enthält keine Seiten.`)
  const { detectJbig2 } = await import('./jbig2')
  const jbig2 = detectJbig2(parsed.getPages()) ?? undefined
  return { id, name: file.name, kind: 'pdf', mime: 'application/pdf', bytes, pages, ...(jbig2 && { jbig2 }) }
}

/** Returns the unencrypted bytes, or null when the user skips the file. */
async function unlock(file: File, bytes: Uint8Array, { askPassword, notify }: ImportOptions): Promise<Uint8Array | null> {
  // The empty password first: files that only restrict permissions open without asking.
  let password = ''
  for (;;) {
    try {
      const plain = await decryptPdf(bytes, password)
      notify?.(
        password
          ? `„${file.name}“ ist entsperrt. Gesicherte Kopien sind nicht mehr passwortgeschützt.`
          : `„${file.name}“ hat Nutzungsbeschränkungen, etwa gegen Drucken. Gesicherte Kopien enthalten sie nicht mehr.`,
      )
      return plain
    } catch (e) {
      if (e instanceof UnsupportedEncryptionError) {
        throw new ImportError(`„${file.name}“ ist mit einem Verfahren geschützt, das hier nicht geöffnet werden kann (etwa Zertifikat oder Rechteverwaltung).`)
      }
      if (!(e instanceof PasswordError)) throw unreadable(file)
    }
    if (!askPassword) throw new ImportError(`„${file.name}“ ist passwortgeschützt.`)
    const next = await askPassword({ name: file.name, wrong: password !== '' })
    if (next === null) return null
    password = next
  }
}

export function blankSource(size: PageSize): Source {
  return { id: newId(), name: 'Leere Seite', kind: 'blank', mime: null, bytes: null, pages: [size] }
}

export { A4 } from '../model/pages'

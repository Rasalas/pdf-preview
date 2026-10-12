import type { PDFFont } from 'pdf-lib'

/** The standard Helvetica only covers WinAnsi; replace what it cannot encode instead of failing the export. */
export function encodable(font: PDFFont, text: string): string {
  return [...text]
    .map((ch) => {
      try {
        font.encodeText(ch)
        return ch
      } catch {
        return '?'
      }
    })
    .join('')
}

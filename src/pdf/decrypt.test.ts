import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { isEncryptedError, loadForExport } from './export'
import { passwordCandidates } from './decrypt'
import { classify, decrypt } from './qpdf'

// A file: URL, which the Emscripten glue reads from disk when it runs in Node.
const wasm = new URL('../../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm', import.meta.url).href

// Small one-page PDFs encrypted with qpdf (via pikepdf); certificate.pdf only names a handler we cannot open.
const files = import.meta.glob('./fixtures/*.pdf', { query: '?inline', import: 'default', eager: true }) as Record<string, string>
async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(files[`./fixtures/${name}.pdf`])).arrayBuffer())
}

/** The text of the first page's content stream. */
async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const stream = doc.context.lookup(doc.getPage(0).node.Contents()) as PDFRawStream
  return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
}

describe('passwordCandidates', () => {
  const text = (list: Uint8Array[]) => list.map((b) => Array.from(b))

  it('offers a single candidate for ASCII', () => {
    expect(text(passwordCandidates('geheim'))).toEqual([[0x67, 0x65, 0x68, 0x65, 0x69, 0x6d]])
    expect(text(passwordCandidates(''))).toEqual([[]])
  })
  it('adds Latin-1 for umlauts, which older files use', () => {
    expect(text(passwordCandidates('Grüße'))).toEqual([
      [0x47, 0x72, 0xc3, 0xbc, 0xc3, 0x9f, 0x65],
      [0x47, 0x72, 0xfc, 0xdf, 0x65],
    ])
  })
  it('keeps only UTF-8 when Latin-1 cannot represent the password', () => {
    expect(passwordCandidates('Pässwört€')).toHaveLength(1)
    expect(passwordCandidates('日本')).toHaveLength(1)
  })
})

describe('classify', () => {
  it('recognises what qpdf reports', () => {
    expect(classify('qpdf: /in.pdf: invalid password')).toBe('password')
    expect(classify('/in.pdf (encryption dictionary, offset 455): unsupported encryption filter')).toBe('unsupported')
    expect(classify('file uses encryption SubFilters, which qpdf does not support')).toBe('unsupported')
    expect(classify('/in.pdf: can\'t find startxref')).toBe('failed')
  })
})

describe('decrypt', () => {
  const variants: [string, string][] = [
    ['rc4-40', 'geheim'],
    ['rc4-128', 'geheim'],
    ['aes-128', 'geheim'],
    ['aes-256-r5', 'geheim'],
    ['aes-256', 'Pässwört€日本'],
    ['rc4-128-latin1', 'Grüße'],
    ['aes-128-owner-only', ''],
    ['aes-256-owner-only', ''],
  ]

  it.each(variants)('opens %s with its password', async (name, password) => {
    const result = await decrypt(wasm, await fixture(name), passwordCandidates(password))

    if (!('bytes' in result)) throw new Error(`no output: ${result.error}`)
    expect(await pageContent(result.bytes)).toContain('Marker1')
  })

  it('reports a wrong or missing password', async () => {
    const bytes = await fixture('aes-256')

    expect(await decrypt(wasm, bytes, passwordCandidates('falsch'))).toEqual({ error: 'password' })
    expect(await decrypt(wasm, bytes, passwordCandidates(''))).toEqual({ error: 'password' })
  })

  it('refuses security handlers other than the standard one', async () => {
    expect(await decrypt(wasm, await fixture('certificate'), passwordCandidates(''))).toEqual({ error: 'unsupported' })
  })

  it('does not leak the captured console', async () => {
    const log = console.log

    await decrypt(wasm, await fixture('aes-128'), passwordCandidates('falsch'))

    expect(console.log).toBe(log)
  })
})

describe('import detection', () => {
  it('recognises the error pdf-lib raises for encrypted files', async () => {
    await expect(loadForExport('encrypted', await fixture('aes-128'))).rejects.toSatisfy(isEncryptedError)
    await expect(loadForExport('encrypted-owner', await fixture('rc4-40'))).rejects.toSatisfy(isEncryptedError)
  })
  it('does not mistake other errors for it', () => {
    expect(isEncryptedError(new Error('Failed to parse PDF document'))).toBe(false)
    expect(isEncryptedError('encrypted')).toBe(false)
  })
})

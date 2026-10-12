import type { DecryptResult } from './qpdf'

export class PasswordError extends Error {}
export class UnsupportedEncryptionError extends Error {}

/**
 * The encodings a password may have been set with: UTF-8 (PDF 2.0, most tools) and Latin-1,
 * which older files (R2 to R4) use for umlauts.
 */
export function passwordCandidates(password: string): Uint8Array[] {
  const utf8 = new TextEncoder().encode(password)
  const codes = Array.from(password, (c) => c.codePointAt(0)!)
  if (codes.some((c) => c > 0xff)) return [utf8]
  const latin1 = Uint8Array.from(codes)
  // Same length means plain ASCII, where both encodings agree.
  return latin1.length === utf8.length ? [utf8] : [utf8, latin1]
}

/**
 * Returns an unencrypted copy. qpdf runs as WebAssembly in a short-lived worker, which frees its
 * memory afterwards and keeps the page responsive on large files. An empty password opens files
 * that only restrict permissions.
 */
export function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const worker = new Worker(new URL('./qpdf.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<DecryptResult>) => {
      worker.terminate()
      if ('bytes' in data) resolve(data.bytes)
      else if (data.error === 'password') reject(new PasswordError())
      else if (data.error === 'unsupported') reject(new UnsupportedEncryptionError())
      else reject(new Error('qpdf failed'))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage({ bytes, passwords: passwordCandidates(password) })
  })
}

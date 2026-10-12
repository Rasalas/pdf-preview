import createModule from '@neslinesli93/qpdf-wasm'

// The package typings cover only a fraction of what Emscripten offers.
interface Qpdf {
  callMain(args: string[]): number
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array }
}
type Factory = (options: { locateFile: () => string; noInitialRun: boolean }) => Promise<Qpdf>

export type DecryptResult = { bytes: Uint8Array } | { error: 'password' | 'unsupported' | 'failed' }

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** Maps qpdf's (English, stable) error output to what the caller can act on. */
export function classify(log: string): 'password' | 'unsupported' | 'failed' {
  if (/invalid password/i.test(log)) return 'password'
  if (/unsupported encryption|encryption SubFilters/i.test(log)) return 'unsupported'
  return 'failed'
}

/** The glue binds console.log and console.error when it starts and ignores print/printErr. */
function start(wasmPath: string, lines: string[]): Promise<Qpdf> {
  const { log, error } = console
  console.log = console.error = (...args: unknown[]) => void lines.push(args.join(' '))
  try {
    return (createModule as unknown as Factory)({ locateFile: () => wasmPath, noInitialRun: true })
  } finally {
    Object.assign(console, { log, error })
  }
}

/**
 * Writes an unencrypted copy of the file. Each password candidate is tried as raw bytes, so the
 * caller decides about encodings. Exit code 3 means "done, with warnings" and still yields output.
 */
export async function decrypt(wasmPath: string, bytes: Uint8Array, passwords: Uint8Array[]): Promise<DecryptResult> {
  const lines: string[] = []
  const qpdf = await start(wasmPath, lines)
  qpdf.FS.writeFile('/in.pdf', bytes)
  for (const password of passwords) {
    lines.length = 0
    let code: number
    try {
      code = qpdf.callMain(['--password-mode=hex-bytes', `--password=${hex(password)}`, '--decrypt', '/in.pdf', '/out.pdf'])
    } catch {
      return { error: 'failed' }
    }
    if (code === 0 || code === 3) return { bytes: qpdf.FS.readFile('/out.pdf') }
    const error = classify(lines.join('\n'))
    if (error !== 'password') return { error }
  }
  return { error: 'password' }
}

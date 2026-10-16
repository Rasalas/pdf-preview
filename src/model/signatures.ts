import { newId } from './ids'
import type { Point } from './types'

/** A signature as paths inside a box of `w` × `h`, or as a picture of that size (then `paths` is empty). */
export interface Signature {
  id: string
  w: number
  h: number
  paths: Point[][]
  /** Per point, from stylus pressure or writing speed. Missing in signatures from before the fountain pen. */
  pressures?: number[][]
  /** Ink colour of drawn signatures. Missing in signatures from before it could be chosen. */
  color?: string
  /** A PNG data URL, for signatures imported from a scan or photo. */
  image?: string
}

export const SIGNATURE_INK = '#1d1d1b'

const FORMAT = 'vorschau-unterschriften'

export function exportSignatures(signatures: Signature[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, signatures: signatures.map(({ w, h, paths, pressures, color, image }) => ({ w, h, paths, pressures, color, image })) })
}

export class SignatureFileError extends Error {}

/** Reads an exported file. Signatures already in `known` are left out; the others get fresh ids. */
export function importSignatures(text: string, known: Signature[]): Signature[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new SignatureFileError('Die Datei ist keine Unterschriften-Datei.')
  }
  const list = (data as { format?: unknown; signatures?: unknown })?.signatures
  if ((data as { format?: unknown })?.format !== FORMAT || !Array.isArray(list)) {
    throw new SignatureFileError('Die Datei ist keine Unterschriften-Datei.')
  }
  const seen = new Set(known.map(fingerprint))
  const out: Signature[] = []
  for (const item of list) {
    if (!isSignature(item)) throw new SignatureFileError('Die Unterschriften-Datei ist beschädigt.')
    const { w, h, paths, pressures, color, image } = item
    const signature: Signature = { id: newId(), w, h, paths, ...(pressures ? { pressures } : {}), ...(color ? { color } : {}), ...(image ? { image } : {}) }
    if (seen.has(fingerprint(signature))) continue
    seen.add(fingerprint(signature))
    out.push(signature)
  }
  return out
}

const fingerprint = (s: Signature) => s.image ?? JSON.stringify(s.paths)

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function isSignature(s: unknown): s is Omit<Signature, 'id'> {
  if (!s || typeof s !== 'object') return false
  const { w, h, paths, pressures, color, image } = s as Record<string, unknown>
  if (!isNumber(w) || !isNumber(h) || !Array.isArray(paths)) return false
  if (color !== undefined && !(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) return false
  if (image !== undefined) return typeof image === 'string' && image.startsWith('data:image/png;base64,')
  if (paths.length === 0) return false
  const pointsOk = paths.every((path) => Array.isArray(path) && path.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNumber)))
  if (!pointsOk) return false
  if (pressures === undefined) return true
  return (
    Array.isArray(pressures) &&
    pressures.length === paths.length &&
    pressures.every((list, i) => Array.isArray(list) && list.length === (paths[i] as unknown[]).length && list.every(isNumber))
  )
}

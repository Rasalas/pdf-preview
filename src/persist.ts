import type { FieldValues } from './model/forms'
import type { OcrResults } from './model/ocr'
import type { Page, Sources } from './model/types'

export interface Session {
  title: string
  pages: Page[]
  sources: Sources
  /** Missing in sessions stored before form support. */
  fields?: FieldValues
  /** Missing in sessions stored before text recognition. */
  ocr?: OcrResults
  savedAt: number
}

const DB = 'vorschau-web'
const STORE = 'session'
const KEY = 'current'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export const loadSession = () => run<Session | undefined>('readonly', (s) => s.get(KEY)).catch(() => undefined)

/** Stores only the sources the current pages use; undo history does not survive a reload. */
export function saveSession(title: string, pages: Page[], sources: Sources, fields: FieldValues = {}, ocr: OcrResults = {}): Promise<unknown> {
  if (pages.length === 0) return clearSession()
  const used: Sources = {}
  const usedFields: FieldValues = {}
  const usedOcr: OcrResults = {}
  for (const p of pages) {
    used[p.sourceId] = sources[p.sourceId]
    if (fields[p.sourceId]) usedFields[p.sourceId] = fields[p.sourceId]
    const read = ocr[p.sourceId]?.[p.index]
    if (read) (usedOcr[p.sourceId] ??= {})[p.index] = read
  }
  const session: Session = { title, pages, sources: used, fields: usedFields, ocr: usedOcr, savedAt: Date.now() }
  return run('readwrite', (s) => s.put(session, KEY)).catch(() => undefined)
}

export const clearSession = () => run('readwrite', (s) => s.delete(KEY)).catch(() => undefined)

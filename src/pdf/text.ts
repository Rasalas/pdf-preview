import type { Source } from '../model/types'
import { openPdf } from './pdfjs'

const strings = new Map<string, Promise<string[]>>()

/**
 * The text items of a page in the order pdf.js's TextLayer renders them,
 * so match counts here line up with highlights in the text layer.
 */
export function pageStrings(source: Source, index: number): Promise<string[]> {
  if (source.kind !== 'pdf') return Promise.resolve([])
  const key = `${source.id}:${index}`
  let result = strings.get(key)
  if (!result) {
    result = (async () => {
      const page = await (await openPdf(source)).getPage(index + 1)
      const { items } = await page.getTextContent()
      return items.flatMap((item) => ('str' in item ? [item.str] : []))
    })()
    result.catch(() => strings.delete(key))
    strings.set(key, result)
  }
  return result
}

export const normalizeQuery = (q: string) => q.trim().toLocaleLowerCase('de')

/** Start/end offsets of case-insensitive matches. Matches spanning two text items are not found. */
export function matchRanges(text: string, query: string): [number, number][] {
  if (!query) return []
  const hay = text.toLocaleLowerCase('de')
  // Offsets only map back if lowercasing kept the length (true for nearly all scripts).
  if (hay.length !== text.length) return []
  const ranges: [number, number][] = []
  for (let i = hay.indexOf(query); i >= 0; i = hay.indexOf(query, i + query.length)) {
    ranges.push([i, i + query.length])
  }
  return ranges
}

export const countMatches = (items: string[], query: string) =>
  items.reduce((n, s) => n + matchRanges(s, query).length, 0)

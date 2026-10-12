import { hasMeaningfulText, type OcrResults } from '../model/ocr'
import type { Page, Source, Sources } from '../model/types'
import { pageStrings } from '../pdf/text'
import type { Job } from './recognize'

/** Whether a page is a scan that has no text yet. `items` are its text items, recognised text included. */
export const isScan = (source: Source, hasOcr: boolean, items: readonly string[]) =>
  source.kind !== 'blank' && !hasOcr && !hasMeaningfulText(items)

/**
 * The pages that still need reading, one job per source page: copies of a page share their text.
 * A page read before in another orientation is read again, so turning a page upright and asking
 * once more fixes a sideways first attempt.
 */
export async function planRecognition(pages: Page[], sources: Sources, ocr: OcrResults): Promise<Job[]> {
  const copies = new Map<string, Page[]>()
  for (const page of pages) {
    const key = `${page.sourceId}:${page.index}`
    copies.set(key, [...(copies.get(key) ?? []), page])
  }
  const jobs: Job[] = []
  for (const group of copies.values()) {
    const { sourceId, index } = group[0]
    const source = sources[sourceId]
    if (source.kind === 'blank') continue
    const read = ocr[sourceId]?.[index]
    if (read ? group.some((p) => p.rotation === read.rotation) : await hasText(source, index)) continue
    jobs.push({ source, index, rotation: group[0].rotation })
  }
  return jobs
}

async function hasText(source: Source, index: number): Promise<boolean> {
  try {
    return hasMeaningfulText(await pageStrings(source, index))
  } catch {
    return false
  }
}

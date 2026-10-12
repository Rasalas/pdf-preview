import { pageFromRecognition, type OcrPage } from '../model/ocr'
import { rotatedSize } from '../model/pages'
import type { PageSize, Rotation, Source } from '../model/types'
import { renderPixels } from '../pdf/pdfjs'
import { prepare, recognize, release } from './engine'

/** What the engine reads best; the page is rendered at this resolution. */
const DPI = 300
// Also iOS Safari's canvas limit (4096 x 4096). A4 at 300 dpi takes about half of it.
const MAX_PIXELS = 4096 * 4096

export interface Job {
  source: Source
  index: number
  /** How the page is turned, so that text which the user turned upright is read upright. */
  rotation: Rotation
}

export interface Hooks {
  cancelled: () => boolean
  /** Before each page, with the number of pages finished so far. */
  start: (finished: number) => void
  /** How far the current page is, 0 to 1. */
  progress: (fraction: number) => void
  page: (job: Job, result: OcrPage) => void
}

export interface Outcome {
  failed: Job[]
  cancelled: boolean
}

/** Width in pixels for a page, 300 dpi unless that would be too many pixels. */
export function pixelWidth(size: PageSize): number {
  const width = (size.width / 72) * DPI
  const height = (size.height / 72) * DPI
  return Math.round(width * Math.min(1, Math.sqrt(MAX_PIXELS / (width * height))))
}

/**
 * Reads pages one after another and hands each result over as soon as it is there. A page that fails
 * is skipped; cancelling stops before the next page. Rejects if the engine cannot start at all.
 */
export async function recognizePages(jobs: Job[], hooks: Hooks): Promise<Outcome> {
  const failed: Job[] = []
  try {
    await prepare()
    for (const [i, job] of jobs.entries()) {
      if (hooks.cancelled()) return { failed, cancelled: true }
      hooks.start(i)
      try {
        hooks.page(job, await readPage(job, hooks.progress))
      } catch (e) {
        console.error('Texterkennung fehlgeschlagen', e)
        failed.push(job)
      }
    }
    return { failed, cancelled: false }
  } finally {
    release()
  }
}

async function readPage({ source, index, rotation }: Job, progress: (fraction: number) => void): Promise<OcrPage> {
  const size = rotatedSize(source.pages[index], rotation)
  const canvas = await renderPixels(source, index, rotation, pixelWidth(size), new AbortController().signal)
  try {
    const scale = canvas.width / size.width
    const blocks = await recognize(canvas, scale * 72, progress)
    return pageFromRecognition(blocks, scale, source.pages[index], rotation)
  } finally {
    // A full-size canvas is hundreds of MB on some systems; do not wait for the garbage collector.
    canvas.width = canvas.height = 0
  }
}

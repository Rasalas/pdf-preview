import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OcrPage, OcrResults } from '../model/ocr'
import type { Page, Source, Sources } from '../model/types'
import { isScan, planRecognition } from './scans'

const text = vi.hoisted(() => ({ items: {} as Record<string, string[]> }))
vi.mock('../pdf/text', () => ({
  pageStrings: (source: Source, index: number) => {
    const items = text.items[`${source.id}:${index}`]
    return items ? Promise.resolve(items) : Promise.reject(new Error('unreadable'))
  },
}))

const size = { width: 100, height: 100 }
const source = (id: string, kind: Source['kind'], pages = 1): Source => ({
  id,
  name: id,
  kind,
  mime: kind === 'image' ? 'image/jpeg' : kind === 'pdf' ? 'application/pdf' : null,
  bytes: null,
  pages: Array.from({ length: pages }, () => size),
})
const sources: Sources = { doc: source('doc', 'pdf', 3), photo: source('photo', 'image'), blank: source('blank', 'blank') }
const page = (id: string, sourceId: string, index = 0, rotation: Page['rotation'] = 0): Page => ({ id, sourceId, index, rotation })
const read = (rotation: OcrPage['rotation']): OcrPage => ({ rotation, lines: [] })

beforeEach(() => {
  text.items = {
    'doc:0': ['Ein Absatz mit genug Text, damit die Seite als Text gilt.'],
    'doc:1': ['Seite 2'],
    // doc:2 cannot be read at all
  }
})

describe('isScan', () => {
  it('is true for pictures and pages with hardly any text, unless text was recognised or the page is blank', () => {
    expect(isScan(sources.photo, false, [])).toBe(true)
    expect(isScan(sources.doc, false, ['Seite 2'])).toBe(true)
    expect(isScan(sources.doc, false, ['Ein Absatz mit genug Text, damit die Seite als Text gilt.'])).toBe(false)
    expect(isScan(sources.photo, true, [])).toBe(false)
    expect(isScan(sources.blank, false, [])).toBe(false)
  })
})

describe('planRecognition', () => {
  it('skips pages that have text and blank pages, and takes the rest', async () => {
    const pages = [page('1', 'doc', 0), page('2', 'doc', 1), page('3', 'photo'), page('4', 'blank')]
    const jobs = await planRecognition(pages, sources, {})
    expect(jobs.map((j) => [j.source.id, j.index])).toEqual([['doc', 1], ['photo', 0]])
  })

  it('reads a page that cannot be checked, and lets the engine fail on it if need be', async () => {
    expect((await planRecognition([page('1', 'doc', 2)], sources, {})).map((j) => j.index)).toEqual([2])
  })

  it('reads copies of a page once, in the orientation of the first', async () => {
    const jobs = await planRecognition([page('1', 'photo', 0, 90), page('2', 'photo', 0, 0)], sources, {})
    expect(jobs).toHaveLength(1)
    expect(jobs[0].rotation).toBe(90)
  })

  it('skips pages that were read, unless they were read in another orientation', async () => {
    const ocr: OcrResults = { photo: { 0: read(0) } }
    expect(await planRecognition([page('1', 'photo', 0, 0)], sources, ocr)).toEqual([])
    // Turned upright since: ask again and it is read again.
    const again = await planRecognition([page('1', 'photo', 0, 270)], sources, ocr)
    expect(again.map((j) => j.rotation)).toEqual([270])
    // A copy that still has the orientation it was read in is enough.
    expect(await planRecognition([page('1', 'photo', 0, 270), page('2', 'photo', 0, 0)], sources, ocr)).toEqual([])
  })
})

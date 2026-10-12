import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Source } from '../model/types'
import { prepare, recognize, release } from './engine'
import { pixelWidth, recognizePages, type Hooks, type Job } from './recognize'

vi.mock('./engine', () => ({ prepare: vi.fn(), recognize: vi.fn(), release: vi.fn() }))
vi.mock('../pdf/pdfjs', () => ({ renderPixels: vi.fn(async (_s: Source, _i: number, _r: number, width: number) => ({ width, height: width * 1.4 })) }))

describe('pixelWidth', () => {
  it('renders at 300 dpi', () => {
    // A4 in points.
    expect(pixelWidth({ width: 595.28, height: 841.89 })).toBe(2480)
    expect(pixelWidth({ width: 842, height: 595 })).toBe(3508)
  })

  it('keeps very large pages within the pixel budget', () => {
    // A0 would be 9933 x 14043 pixels at 300 dpi.
    const size = { width: 2384, height: 3370 }
    const width = pixelWidth(size)
    const height = (width / size.width) * size.height
    expect(width * height).toBeLessThanOrEqual(4096 * 4096)
    expect(width * height).toBeGreaterThan(4096 * 4096 * 0.99)
  })

  it('upscales small pages to the resolution the engine reads best', () => {
    expect(pixelWidth({ width: 72, height: 36 })).toBe(300)
  })
})

describe('recognizePages', () => {
  const source: Source = { id: 's', name: 's.pdf', kind: 'pdf', mime: 'application/pdf', bytes: null, pages: Array.from({ length: 3 }, () => ({ width: 100, height: 140 })) }
  const jobs: Job[] = [0, 1, 2].map((index) => ({ source, index, rotation: 0 }))
  // One word per page, as the engine reports it.
  const word = (text: string) => [{ paragraphs: [{ lines: [{ words: [{ text, confidence: 90, bbox: { x0: 10, y0: 10, x1: 60, y1: 30 } }] }] }] }]
  const hooks = (over: Partial<Hooks> = {}) => {
    const seen = { started: [] as number[], texts: [] as string[] }
    const all: Hooks = {
      cancelled: () => false,
      start: (n) => seen.started.push(n),
      progress: () => undefined,
      page: ({ index }, page) => seen.texts.push(`${index}:${page.lines[0]?.words[0].text}`),
      ...over,
    }
    return { all, seen }
  }

  beforeEach(() => {
    vi.mocked(prepare).mockReset().mockResolvedValue(undefined)
    vi.mocked(release).mockReset()
    vi.mocked(recognize).mockReset()
    vi.mocked(recognize).mockImplementation(async () => word('Hallo'))
  })

  it('hands over each page as soon as it is read, and lets go of the engine afterwards', async () => {
    const { all, seen } = hooks()
    expect(await recognizePages(jobs, all)).toEqual({ failed: [], cancelled: false })
    expect(seen.started).toEqual([0, 1, 2])
    expect(seen.texts).toEqual(['0:Hallo', '1:Hallo', '2:Hallo'])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('skips a page that fails and goes on with the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(recognize).mockImplementationOnce(async () => word('Eins')).mockRejectedValueOnce(new Error('out of memory'))
    const { all, seen } = hooks()
    const outcome = await recognizePages(jobs, all)
    expect(outcome.failed.map((j) => j.index)).toEqual([1])
    expect(seen.texts).toEqual(['0:Eins', '2:Hallo'])
  })

  it('stops before the next page when cancelled, keeping what is done', async () => {
    let finished = 0
    const { all, seen } = hooks({ cancelled: () => finished >= 1, page: () => finished++ })
    const outcome = await recognizePages(jobs, all)
    expect(outcome.cancelled).toBe(true)
    expect(seen.started).toEqual([0])
    expect(finished).toBe(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('rejects when the engine cannot start, and still lets go of it', async () => {
    vi.mocked(prepare).mockRejectedValue(new Error('no worker'))
    await expect(recognizePages(jobs, hooks().all)).rejects.toThrow('no worker')
    expect(release).toHaveBeenCalledTimes(1)
  })
})

import { A4 } from './pages'
import type { PageSize, Point, Rect } from './types'

const MARGIN = 36
const GAP = 24

export const LANDSCAPE_A4: PageSize = { width: A4.height, height: A4.width }

export interface Sheet {
  size: PageSize
  /** Where each page goes, in points from the sheet's top-left corner. */
  places: Rect[]
}

/**
 * Lays pages out in reading order on the roomiest of `sheets`, in a grid and all at one scale so
 * their sizes keep their proportions. Never enlarges a page beyond its own size.
 */
export function layoutSheet(sizes: PageSize[], sheets: PageSize[] = [A4, LANDSCAPE_A4]): Sheet {
  let best: (Sheet & { scale: number }) | null = null
  for (const size of sheets) {
    for (let columns = 1; columns <= sizes.length; columns++) {
      const sheet = grid(sizes, size, columns)
      if (!best || sheet.scale > best.scale + 1e-6) best = sheet
    }
  }
  const { size, places } = best!
  return { size, places }
}

function grid(sizes: PageSize[], sheet: PageSize, columns: number) {
  const rows = Math.ceil(sizes.length / columns)
  const widths = Array<number>(columns).fill(0)
  const heights = Array<number>(rows).fill(0)
  sizes.forEach(({ width, height }, i) => {
    widths[i % columns] = Math.max(widths[i % columns], width)
    heights[Math.floor(i / columns)] = Math.max(heights[Math.floor(i / columns)], height)
  })
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)
  const margin = marginOf(sheet)
  const scale = Math.min(
    1,
    (sheet.width - 2 * margin - (columns - 1) * GAP) / sum(widths),
    (sheet.height - 2 * margin - (rows - 1) * GAP) / sum(heights),
  )
  // Leftover space goes around and between the rows and columns alike, which leaves room to cut.
  const spaceX = (sheet.width - scale * sum(widths)) / (columns + 1)
  const spaceY = (sheet.height - scale * sum(heights)) / (rows + 1)
  const offset = (list: number[], space: number, i: number) => space * (i + 1) + scale * sum(list.slice(0, i))
  const places = sizes.map(({ width, height }, i) => {
    const column = i % columns
    const row = Math.floor(i / columns)
    return {
      x: offset(widths, spaceX, column) + (scale * (widths[column] - width)) / 2,
      y: offset(heights, spaceY, row) + (scale * (heights[row] - height)) / 2,
      w: scale * width,
      h: scale * height,
    }
  })
  return { size: sheet, places, scale }
}

/** A page dropped at `at` on `host`: centred there, shrunk to fit inside the margins, kept on the page. */
export function placeAt(size: PageSize, host: PageSize, at: Point): Rect {
  const margin = marginOf(host)
  const scale = Math.min(1, (host.width - 2 * margin) / size.width, (host.height - 2 * margin) / size.height)
  const w = size.width * scale
  const h = size.height * scale
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
  return { x: clamp(at[0] - w / 2, 0, host.width - w), y: clamp(at[1] - h / 2, 0, host.height - h), w, h }
}

// Small pages, such as a receipt, get a margin in proportion.
const marginOf = (size: PageSize) => Math.min(MARGIN, Math.min(size.width, size.height) * 0.08)

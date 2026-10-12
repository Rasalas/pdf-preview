import { toPageSpace, userSpaceMatrix } from './annotations'
import { rotatedSize } from './pages'
import type { Page, PageSize, Point, Rect, Rotation } from './types'

/** Smallest crop edge in points; a page smaller than that can be cropped down to its own size. */
export const MIN_CROP = 24
/** A crop within this many points of every page edge is no crop. */
const WHOLE = 0.5

export type CropHandle = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

type Shown = Pick<Page, 'rotation' | 'crop'>

/** A page's size without the user's rotation, and the rotation to show it with. */
interface View {
  size: PageSize
  rotation: Rotation
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const fullRect = (size: PageSize): Rect => ({ x: 0, y: 0, w: size.width, h: size.height })

/** Fits a rectangle into the page, no smaller than MIN_CROP. */
export function clampRect(r: Rect, size: PageSize): Rect {
  const w = clamp(r.w, Math.min(MIN_CROP, size.width), size.width)
  const h = clamp(r.h, Math.min(MIN_CROP, size.height), size.height)
  return { x: clamp(r.x, 0, size.width - w), y: clamp(r.y, 0, size.height - h), w, h }
}

/** The crop to store: fitted to the page, or undefined when it leaves the whole page visible. */
export function normalizeCrop(r: Rect | null | undefined, size: PageSize): Rect | undefined {
  if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) return undefined
  const c = clampRect(r, size)
  const whole = c.x < WHOLE && c.y < WHOLE && size.width - c.x - c.w < WHOLE && size.height - c.y - c.h < WHOLE
  return whole ? undefined : c
}

/** The visible part of a page in page space. */
export function cropRect(size: PageSize, crop: Rect | undefined): Rect {
  return normalizeCrop(crop, size) ?? fullRect(size)
}

function rectOf(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }
}

/** The inverse of toPageSpace: a point of the page as it is displayed with the user's rotation. */
export function toViewSpace([x, y]: Point, size: PageSize, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return [x, y]
    case 90:
      return [size.height - y, x]
    case 180:
      return [size.width - x, size.height - y]
    case 270:
      return [y, size.width - x]
  }
}

/** A rectangle of page space on the page as displayed, rotated. */
export function viewRect(r: Rect, size: PageSize, rotation: Rotation): Rect {
  return rectOf(toViewSpace([r.x, r.y], size, rotation), toViewSpace([r.x + r.w, r.y + r.h], size, rotation))
}

/** A rectangle of the page as displayed, rotated, back in page space. */
export function sourceRect(r: Rect, size: PageSize, rotation: Rotation): Rect {
  return rectOf(toPageSpace([r.x, r.y], size, rotation), toPageSpace([r.x + r.w, r.y + r.h], size, rotation))
}

/** The visible part of a page inside the whole page as displayed, in points. */
export function visibleRect(size: PageSize, page: Shown): Rect {
  return viewRect(cropRect(size, page.crop), size, page.rotation)
}

/** What a page shows: cropped first, then rotated. `size` is the page's own size from its source. */
export function displayedSize(size: PageSize, page: Shown): PageSize {
  const { w, h } = visibleRect(size, page)
  return { width: w, height: h }
}

/** Moves or resizes a rectangle on the displayed page by a pointer delta, keeping it inside `bounds`. */
export function dragCrop(start: Rect, handle: CropHandle, dx: number, dy: number, bounds: PageSize): Rect {
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, bounds.width - start.w), y: clamp(start.y + dy, 0, bounds.height - start.h) }
  }
  const minW = Math.min(MIN_CROP, bounds.width)
  const minH = Math.min(MIN_CROP, bounds.height)
  let [left, top, right, bottom] = [start.x, start.y, start.x + start.w, start.y + start.h]
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minW)
  if (handle.includes('e')) right = clamp(right + dx, left + minW, bounds.width)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minH)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minH, bounds.height)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * The crop of `from` for another page: the same rectangle as displayed, relative to that page's
 * size, fitted to it. Pages of other sizes, orientations or rotations get their own point values.
 */
export function sameCropFor(crop: Rect, from: View, to: View): Rect | undefined {
  const shown = viewRect(crop, from.size, from.rotation)
  const a = rotatedSize(from.size, from.rotation)
  const b = rotatedSize(to.size, to.rotation)
  const [kx, ky] = [b.width / a.width, b.height / a.height]
  const scaled = { x: shown.x * kx, y: shown.y * ky, w: shown.w * kx, h: shown.h * ky }
  return normalizeCrop(sourceRect(scaled, to.size, to.rotation), to.size)
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The crop as a PDF CropBox in user space. `box` is the page's current crop box and `rotate` its own
 * /Rotate, which together say how page space (y down, rotated) maps onto user space (y up).
 */
export function cropBoxOf(crop: Rect, rotate: number, box: Box): Box {
  const turned = ((rotate % 180) + 180) % 180 !== 0
  const shown = turned ? { width: box.height, height: box.width } : box
  const c = clampRect(crop, shown)
  const m = userSpaceMatrix(rotate, box)
  const at = ([x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
  const a = at([c.x, shown.height - c.y])
  const b = at([c.x + c.w, shown.height - c.y - c.h])
  const round = (n: number) => Math.round(n * 1000) / 1000
  return {
    x: round(Math.min(a[0], b[0])),
    y: round(Math.min(a[1], b[1])),
    width: round(Math.abs(a[0] - b[0])),
    height: round(Math.abs(a[1] - b[1])),
  }
}

/** The crop in the unrotated frame of a form page, to find the fields that are still visible. */
export function rawCrop(crop: Rect, raw: PageSize, rotate: number): Rect {
  return sourceRect(crop, raw, ((rotate % 360) + 360) % 360 as Rotation)
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

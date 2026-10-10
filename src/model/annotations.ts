import type { Annotation, PageSize, Point, Rect, Rotation } from './types'

/** Distance from a text box's top to the first baseline, as a fraction of the font size. */
export const TEXT_ASCENT = 0.78
export const LINE_HEIGHT = 1.2

export type Measure = (text: string, size: number) => number

export function bounds(a: Annotation, measure: Measure): Rect {
  switch (a.type) {
    case 'highlight':
      return union(a.rects)
    case 'rect':
    case 'ellipse':
      return { x: a.x, y: a.y, w: a.w, h: a.h }
    case 'line':
      return pointsBox([a.p1, a.p2])
    case 'ink':
      return pointsBox(a.paths.flat())
    case 'text': {
      const lines = a.text.split('\n')
      const w = Math.max(a.size, ...lines.map((l) => measure(l, a.size)))
      return { x: a.x, y: a.y, w, h: lines.length * a.size * LINE_HEIGHT }
    }
  }
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  const p = ([x, y]: Point): Point => [x + dx, y + dy]
  switch (a.type) {
    case 'highlight':
      return { ...a, rects: a.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) }
    case 'rect':
    case 'ellipse':
    case 'text':
      return { ...a, x: a.x + dx, y: a.y + dy }
    case 'line':
      return { ...a, p1: p(a.p1), p2: p(a.p2) }
    case 'ink':
      return { ...a, paths: a.paths.map((path) => path.map(p)) }
  }
}

/** Fits an annotation from box `from` into box `to`. Text scales its font size. */
export function resize(a: Annotation, from: Rect, to: Rect): Annotation {
  const sx = from.w ? to.w / from.w : 1
  const sy = from.h ? to.h / from.h : 1
  const p = ([x, y]: Point): Point => [to.x + (x - from.x) * sx, to.y + (y - from.y) * sy]
  switch (a.type) {
    case 'rect':
    case 'ellipse':
      return { ...a, ...to }
    case 'ink':
      return { ...a, paths: a.paths.map((path) => path.map(p)) }
    case 'line':
      return { ...a, p1: p(a.p1), p2: p(a.p2) }
    case 'text':
      return { ...a, x: to.x, y: to.y, size: Math.max(4, a.size * sy) }
    case 'highlight':
      return a
  }
}

/** Converts a point on the displayed (rotated) page, in points, back to page space. */
export function toPageSpace([dx, dy]: Point, size: PageSize, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return [dx, dy]
    case 90:
      return [dy, size.height - dx]
    case 180:
      return [size.width - dx, size.height - dy]
    case 270:
      return [size.width - dy, dx]
  }
}

/** CSS transform that turns the unrotated page layer into its displayed orientation. */
export function rotationTransform(size: PageSize, rotation: Rotation, scale: number): string {
  const w = size.width * scale
  const h = size.height * scale
  switch (rotation) {
    case 0:
      return 'none'
    case 90:
      return `translate(${h}px, 0) rotate(90deg)`
    case 180:
      return `translate(${w}px, ${h}px) rotate(180deg)`
    case 270:
      return `translate(0, ${w}px) rotate(270deg)`
  }
}

/**
 * Matrix (a b c d e f) mapping y-up coordinates of the page as displayed with
 * its own /Rotate onto PDF user space of a page with the given crop box.
 */
export function userSpaceMatrix(
  rotate: number,
  box: { x: number; y: number; width: number; height: number },
): [number, number, number, number, number, number] {
  const { x, y, width, height } = box
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return [0, 1, -1, 0, x + width, y]
    case 180:
      return [-1, 0, 0, -1, x + width, y + height]
    case 270:
      return [0, -1, 1, 0, x, y + height]
    default:
      return [1, 0, 0, 1, x, y]
  }
}

/** Merges the per-glyph-run rectangles of a text selection into one rectangle per line. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = rects.filter((r) => r.w > 0.5 && r.h > 0.5).sort((a, b) => a.y - b.y || a.x - b.x)
  const out: Rect[] = []
  for (const r of sorted) {
    const last = out.at(-1)
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) / 2
    if (last && sameLine && r.x <= last.x + last.w + r.h) {
      const merged = union([last, r])
      out[out.length - 1] = merged
    } else {
      out.push({ ...r })
    }
  }
  return out
}

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const x2 = Math.max(...rects.map((r) => r.x + r.w))
  const y2 = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: x2 - x, h: y2 - y }
}

function pointsBox(points: Point[]): Rect {
  return union(points.map(([x, y]) => ({ x, y, w: 0, h: 0 })))
}

/** Points of an arrowhead at p2, pointing away from p1. */
export function arrowHead(p1: Point, p2: Point, width: number): Point[] {
  const len = Math.max(8, width * 4)
  const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0])
  const wing = (s: number): Point => [
    p2[0] - len * Math.cos(angle + s * 0.45),
    p2[1] - len * Math.sin(angle + s * 0.45),
  ]
  return [p2, wing(1), wing(-1)]
}

/** Where a line should stop so its round cap does not poke through the arrowhead's tip. */
export function lineEnd(p1: Point, p2: Point, width: number): Point {
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  if (len === 0) return p2
  const back = Math.min(len, Math.max(8, width * 4) * 0.6)
  return [p2[0] - ((p2[0] - p1[0]) / len) * back, p2[1] - ((p2[1] - p1[1]) / len) * back]
}

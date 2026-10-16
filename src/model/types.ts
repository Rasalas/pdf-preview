export type Rotation = 0 | 90 | 180 | 270

/** Size in PDF points with the page's own /Rotate already applied. */
export interface PageSize {
  width: number
  height: number
}

/** An imported file. Never mutated, so pages can reference it across undo/redo. */
export interface Source {
  id: string
  name: string
  kind: 'pdf' | 'image' | 'blank'
  mime: 'application/pdf' | 'image/png' | 'image/jpeg' | null
  bytes: Uint8Array | null
  pages: PageSize[]
  /** Set when a PDF holds JBIG2 images; `symbols` when they may have been coded lossily (see pdf/jbig2.ts). */
  jbig2?: 'lossless' | 'symbols'
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Point = [x: number, y: number]

/**
 * Markup drawn over a page. Coordinates are PDF points in the source page's
 * own orientation (before the user's rotation), origin top-left.
 */
export type Annotation =
  | { id: string; type: 'highlight'; color: string; rects: Rect[] }
  | ({ id: string; type: 'rect' | 'ellipse'; color: string; width: number } & Rect)
  | { id: string; type: 'line'; color: string; width: number; arrow: boolean; p1: Point; p2: Point }
  /** `nib`: drawn with the fountain pen, its width varying along the stroke; `pressures` from a stylus, per point. */
  | { id: string; type: 'ink'; color: string; width: number; paths: Point[][]; nib?: boolean; pressures?: number[][] }
  | { id: string; type: 'text'; color: string; size: number; x: number; y: number; text: string }
  /** A picture, such as a signature imported from a scan. `src` is a PNG data URL. */
  | ({ id: string; type: 'image'; src: string } & Rect)
  /** Another page laid onto this one, filling the box. It keeps its own rotation, crop and markup. */
  | ({ id: string; type: 'page'; page: Page } & Rect)

/** A page in the working document: a view onto one page of a source. */
export interface Page {
  id: string
  sourceId: string
  index: number
  rotation: Rotation
  annotations?: Annotation[]
  /**
   * The visible part of the page, in the same space as annotations (points, own /Rotate applied,
   * before the user's rotation, origin top-left). Missing means the whole page.
   */
  crop?: Rect
}

export type Sources = Record<string, Source>

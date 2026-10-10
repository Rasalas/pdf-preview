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
}

/** A page in the working document: a view onto one page of a source. */
export interface Page {
  id: string
  sourceId: string
  index: number
  rotation: Rotation
}

export type Sources = Record<string, Source>

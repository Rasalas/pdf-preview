import type { PDFPage } from 'pdf-lib'
import { cropBoxOf } from '../model/crop'
import type { Rect } from '../model/types'

/** Narrows the page's CropBox to the crop. The content, including text outside it, stays in the file. */
export function applyCrop(page: PDFPage, rotate: number, crop: Rect) {
  const { x, y, width, height } = cropBoxOf(crop, rotate, page.getCropBox())
  page.setCropBox(x, y, width, height)
}

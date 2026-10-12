export interface Span {
  top: number
  bottom: number
}

/**
 * The gap a pointer at `y` rests in, judged by the page `index` it is next to:
 * before the page when above its frame, after it when below, none when level with it.
 */
export function gapNear(index: number, frame: Span, y: number): number | null {
  if (y < frame.top) return index
  if (y > frame.bottom) return index + 1
  return null
}

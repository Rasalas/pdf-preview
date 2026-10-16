import { getStroke } from 'perfect-freehand'
import type { Point } from './types'

/**
 * Outline of a fountain-pen stroke, to be filled. Pen pressure sets the width where there is one;
 * otherwise speed does, from the spacing of the points: fast is thin, slow is full.
 */
export function nibOutline(path: Point[], width: number, pressures?: number[]): Point[] {
  const input = pressures ? path.map(([x, y], i) => [x, y, pressures[i] ?? 0.5]) : path
  return getStroke(input, {
    size: width * 2.5,
    thinning: 0.65,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: !pressures,
    last: true,
  }) as Point[]
}

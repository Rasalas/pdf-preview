import { describe, expect, it } from 'vitest'
import { gapNear } from './hover'

describe('gapNear', () => {
  const frame = { top: 100, bottom: 200 }
  it('is the gap before the page above its frame', () => {
    expect(gapNear(4, frame, 90)).toBe(4)
    expect(gapNear(0, frame, 0)).toBe(0)
  })
  it('is the gap after the page below its frame', () => {
    expect(gapNear(4, frame, 210)).toBe(5)
  })
  it('is none level with the frame, edges included', () => {
    expect(gapNear(4, frame, 100)).toBeNull()
    expect(gapNear(4, frame, 150)).toBeNull()
    expect(gapNear(4, frame, 200)).toBeNull()
  })
})

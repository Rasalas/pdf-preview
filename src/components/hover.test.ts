import { describe, expect, it } from 'vitest'
import { actionTitle, gapNear } from './hover'

describe('actionTitle', () => {
  it('names a single page by the action alone', () => {
    expect(actionTitle('rotateLeft', 1)).toBe('Nach links drehen')
    expect(actionTitle('rotateRight', 1)).toBe('Nach rechts drehen')
    expect(actionTitle('remove', 1)).toBe('Seite löschen')
  })
  it('counts the pages of a selection', () => {
    expect(actionTitle('rotateRight', 3)).toBe('3 Seiten nach rechts drehen')
    expect(actionTitle('rotateLeft', 2)).toBe('2 Seiten nach links drehen')
    expect(actionTitle('remove', 12)).toBe('12 Seiten löschen')
  })
})

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

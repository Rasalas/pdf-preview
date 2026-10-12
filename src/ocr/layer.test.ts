import { describe, expect, it } from 'vitest'
import type { OcrPage } from '../model/ocr'
import { placeWords } from './layer'

const size = { width: 200, height: 300 }
// Every character is half an em wide.
const measure = (text: string) => text.length / 2

describe('placeWords', () => {
  const page: OcrPage = {
    rotation: 0,
    lines: [{ words: [{ text: 'Hallo', x: 10, y: 20, w: 25, h: 10 }, { text: 'Welt', x: 40, y: 20, w: 40, h: 10 }] }],
  }

  it('sizes the font to the box and stretches the word to its width', () => {
    const [[hallo, welt]] = placeWords(page, size, measure)
    expect(hallo).toMatchObject({ x: 10, y: 20, size: 10, stretch: 1 })
    // "Welt" is 2 em = 20 points wide by itself and has to fill 40.
    expect(welt.stretch).toBe(2)
  })

  it('places words in the page as it was read, whatever the page rotation was then', () => {
    const turned: OcrPage = { rotation: 90, lines: [{ words: [{ text: 'Quer', x: 20, y: 250, w: 10, h: 40 }] }] }
    const [[word]] = placeWords(turned, size, measure)
    // Read after turning right the page is 300 wide: the box is upright there.
    expect(word).toMatchObject({ x: 10, y: 20, size: 10 })
    expect(word.stretch).toBe(2)
  })

  it('leaves an unmeasurable word unstretched', () => {
    const [[word]] = placeWords(page, size, () => 0)
    expect(word.stretch).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { storageValue, toWidgets, type RawWidget } from './forms'

// Like a pdf.js viewport at scale 1 without rotation: y flips, the page is 200 x 300 points.
const viewport = { convertToViewportPoint: (x: number, y: number) => [x, 300 - y] }

const raw = (extra: Partial<RawWidget>): RawWidget => ({
  subtype: 'Widget',
  id: '1R',
  rect: [10, 250, 110, 270],
  fieldName: 'name',
  fieldType: 'Tx',
  ...extra,
})

describe('toWidgets', () => {
  it('places a widget on the unrotated page, origin top left', () => {
    const [w] = toWidgets([raw({ rect: [110, 270, 10, 250] })], viewport)
    expect(w.rect).toEqual({ x: 10, y: 30, w: 100, h: 20 })
  })

  it('maps text fields', () => {
    const [w] = toWidgets(
      [raw({ fieldValue: 'Hallo', multiLine: true, maxLen: 5, comb: true, textAlignment: 1, defaultAppearanceData: { fontSize: 11, fontName: 'Courier', fontColor: [255, 0, 0] } })],
      viewport,
    )
    expect(w).toMatchObject({ type: 'text', value: 'Hallo', multiline: true, comb: true, maxLength: 5, align: 'center', fontSize: 11, font: 'mono', color: 'rgb(255 0 0)' })
  })

  it('treats comb without a length as plain text', () => {
    expect(toWidgets([raw({ comb: true })], viewport)[0]).toMatchObject({ comb: false })
  })

  it('maps dropdowns and list boxes', () => {
    const options = [{ exportValue: 'de', displayValue: 'Deutschland' }]
    const [drop, boxy] = toWidgets(
      [
        raw({ fieldType: 'Ch', combo: true, fieldFlags: 1 << 18, fieldValue: ['de'], options }),
        raw({ id: '2R', fieldName: 'l', fieldType: 'Ch', multiSelect: true, fieldValue: ['a', ''], options }),
      ],
      viewport,
    )
    expect(drop).toMatchObject({ type: 'choice', combo: true, editable: true, value: ['de'], options: [{ value: 'de', label: 'Deutschland' }] })
    expect(boxy).toMatchObject({ combo: false, editable: false, multiple: true, value: ['a'] })
  })

  it('maps checkboxes and radio buttons by their export values', () => {
    const [box, off, radio, noState] = toWidgets(
      [
        raw({ fieldType: 'Btn', checkBox: true, exportValue: 'Ja', fieldValue: 'Ja' }),
        raw({ id: '2R', fieldType: 'Btn', checkBox: true, fieldValue: 'Off' }),
        raw({ id: '3R', fieldName: 'g', fieldType: 'Btn', radioButton: true, buttonValue: 'Herr', fieldValue: 'Frau', alternativeText: 'Anrede' }),
        raw({ id: '4R', fieldName: 'g', fieldType: 'Btn', radioButton: true, buttonValue: null }),
      ],
      viewport,
    )
    expect(box).toMatchObject({ type: 'checkbox', on: 'Ja', value: 'Ja' })
    expect(off).toMatchObject({ type: 'checkbox', on: 'Yes', value: 'Off' })
    expect(radio).toMatchObject({ type: 'radio', on: 'Herr', value: 'Frau', label: 'Anrede: Herr' })
    expect(noState.type).toBe('button')
  })

  it('keeps push buttons as non-interactive, skips signatures and hidden widgets', () => {
    const widgets = toWidgets(
      [
        raw({ fieldType: 'Btn', pushButton: true }),
        raw({ id: '2R', fieldType: 'Sig' }),
        raw({ id: '3R', annotationFlags: 2 }),
        raw({ id: '4R', annotationFlags: 32 }),
        { ...raw({ id: '5R' }), subtype: 'Link' },
      ],
      viewport,
    )
    expect(widgets.map((w) => w.type)).toEqual(['button'])
  })

  it('shows fields without a name but does not let them be edited', () => {
    expect(toWidgets([raw({ fieldName: '' })], viewport)[0].readOnly).toBe(true)
  })

  it('reads border, background and the rotation of the content', () => {
    const [w] = toWidgets(
      [raw({ rotation: 450, borderStyle: { width: 2, style: 5 }, borderColor: [0, 0, 0], backgroundColor: [255, 255, 230] })],
      viewport,
    )
    expect(w).toMatchObject({ turn: 90, border: { width: 2, color: 'rgb(0 0 0)', style: 'underline' }, background: 'rgb(255 255 230)' })
    expect(toWidgets([raw({ borderColor: null })], viewport)[0].border.width).toBe(0)
  })
})

describe('storageValue', () => {
  const [text, box, radio, combo, list] = toWidgets(
    [
      raw({ fieldValue: 'alt' }),
      raw({ id: '2R', fieldName: 'c', fieldType: 'Btn', checkBox: true, exportValue: 'Ja', fieldValue: 'Off' }),
      raw({ id: '3R', fieldName: 'r', fieldType: 'Btn', radioButton: true, buttonValue: 'B' }),
      raw({ id: '4R', fieldName: 'd', fieldType: 'Ch', combo: true, fieldValue: ['x'] }),
      raw({ id: '5R', fieldName: 'l', fieldType: 'Ch', multiSelect: true }),
    ],
    viewport,
  )

  it('hands pdf.js the shape it reads for each kind of field', () => {
    const entered = { name: 'neu', c: 'Ja', r: 'B', d: 'y', l: ['p', 'q'] }
    expect(storageValue(text, entered)).toBe('neu')
    expect(storageValue(box, entered)).toBe(true)
    expect(storageValue(radio, entered)).toBe(true)
    expect(storageValue(combo, entered)).toBe('y')
    expect(storageValue(list, entered)).toEqual(['p', 'q'])
  })

  it('falls back to the values stored in the PDF', () => {
    expect(storageValue(text, {})).toBe('alt')
    expect(storageValue(box, {})).toBe(false)
    expect(storageValue(radio, { r: 'A' })).toBe(false)
    expect(storageValue(combo, {})).toBe('x')
    expect(storageValue(list, {})).toEqual([])
  })
})

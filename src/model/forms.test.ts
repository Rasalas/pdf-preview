import { describe, expect, it } from 'vitest'
import { OFF, click, fontSizeOf, isChecked, isInteractive, listOf, sameValue, textOf, toStore, type CheckWidget, type ChoiceWidget, type TextWidget } from './forms'

const base = {
  id: '1R',
  name: 'f',
  label: 'f',
  rect: { x: 0, y: 0, w: 100, h: 20 },
  turn: 0 as const,
  readOnly: false,
  required: false,
  border: { width: 1, color: '#000', style: 'solid' as const },
  background: null,
}

const text: TextWidget = { ...base, type: 'text', value: 'Vorgabe', multiline: false, password: false, comb: false, maxLength: 0, align: 'left', fontSize: 0, font: 'sans', color: '#000' }
const box: CheckWidget = { ...base, type: 'checkbox', on: 'Yes', value: OFF }
const radio: CheckWidget = { ...base, type: 'radio', on: 'Herr', value: 'Frau' }
const list: ChoiceWidget = { ...base, type: 'choice', value: ['a'], options: [], combo: false, editable: false, multiple: true, fontSize: 12, font: 'sans', color: '#000' }

describe('values', () => {
  it('shows what was entered, else what the PDF stores', () => {
    expect(textOf(text, undefined)).toBe('Vorgabe')
    expect(textOf(text, { f: '' })).toBe('')
    expect(listOf(list, { f: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(listOf(list, undefined)).toEqual(['a'])
  })

  it('stores nothing when an edit goes back to the original', () => {
    expect(toStore(text, 'Vorgabe')).toBeNull()
    expect(toStore(text, 'anders')).toBe('anders')
    expect(toStore(text, '')).toBe('')
    expect(toStore(list, ['a'])).toBeNull()
    expect(toStore(box, OFF)).toBeNull()
  })

  it('compares lists and strings alike', () => {
    expect(sameValue('a', ['a'])).toBe(true)
    expect(sameValue('', [])).toBe(true)
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})

describe('checkboxes and radio buttons', () => {
  it('a checkbox toggles between its export value and Off', () => {
    expect(isChecked(box, undefined)).toBe(false)
    expect(click(box, undefined)).toBe('Yes')
    expect(click(box, { f: 'Yes' })).toBe(OFF)
  })

  it('a radio button belongs to the group value and stays selected when clicked again', () => {
    expect(isChecked(radio, undefined)).toBe(false)
    expect(isChecked(radio, { f: 'Herr' })).toBe(true)
    expect(click(radio, { f: 'Herr' })).toBe('Herr')
  })
})

describe('fontSizeOf', () => {
  it('uses the stored size', () => {
    expect(fontSizeOf({ ...text, fontSize: 9 })).toBe(9)
  })

  it('sizes automatic text by the height of the field, within limits', () => {
    expect(fontSizeOf({ ...text, rect: { ...base.rect, h: 20 } })).toBe(12)
    expect(fontSizeOf({ ...text, rect: { ...base.rect, h: 10 } })).toBe(7)
    expect(fontSizeOf({ ...text, rect: { ...base.rect, h: 4 } })).toBe(5)
    expect(fontSizeOf({ ...text, multiline: true, rect: { ...base.rect, h: 80 } })).toBe(10)
  })
})

describe('isInteractive', () => {
  it('excludes read-only fields and push buttons', () => {
    expect(isInteractive(text)).toBe(true)
    expect(isInteractive({ ...text, readOnly: true })).toBe(false)
    expect(isInteractive({ ...base, type: 'button' })).toBe(false)
  })
})

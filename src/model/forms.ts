import type { Rect, Rotation } from './types'

/**
 * What the user entered: text, the export value of a checkbox, radio button or dropdown
 * entry (or "Off"), or the selected export values of a list box.
 */
export type FieldValue = string | string[]

/** Entered values by source id and fully qualified field name. Fields not listed keep the PDF's value. */
export type FieldValues = Record<string, Record<string, FieldValue>>

export const OFF = 'Off'

export interface Option {
  value: string
  label: string
}

export type FontFamily = 'sans' | 'serif' | 'mono'

export interface Border {
  width: number
  color: string | null
  style: 'solid' | 'dashed' | 'underline'
}

interface Base {
  /** pdf.js annotation id; unique per widget, shared by duplicated pages. */
  id: string
  name: string
  /** Accessible name. */
  label: string
  /** Points, in the page's own unrotated orientation, origin top left. */
  rect: Rect
  /** Degrees counter-clockwise the widget's content is turned against the page (/MK /R). */
  turn: Rotation
  readOnly: boolean
  required: boolean
  border: Border
  background: string | null
}

interface Typeset {
  /** 0 lets the viewer choose. */
  fontSize: number
  font: FontFamily
  color: string
}

export interface TextWidget extends Base, Typeset {
  type: 'text'
  /** The value stored in the PDF. */
  value: string
  multiline: boolean
  password: boolean
  comb: boolean
  /** 0 for unlimited. */
  maxLength: number
  align: 'left' | 'center' | 'right'
}

export interface ChoiceWidget extends Base, Typeset {
  type: 'choice'
  value: string[]
  options: Option[]
  combo: boolean
  editable: boolean
  multiple: boolean
}

export interface CheckWidget extends Base {
  type: 'checkbox' | 'radio'
  /** Export value of the checked state. */
  on: string
  /** Export value of what is checked in the whole field, or "Off". */
  value: string
}

/** Push buttons: only drawn, never interactive. */
export interface ButtonWidget extends Base {
  type: 'button'
}

export type Widget = TextWidget | ChoiceWidget | CheckWidget | ButtonWidget

export type Entered = Record<string, FieldValue> | undefined

export const isInteractive = (w: Widget) => w.type !== 'button' && !w.readOnly

/** The value to show: what the user entered, else what the PDF stores. */
export function valueOf(w: Widget, entered: Entered): FieldValue {
  const value = entered?.[w.name]
  if (value !== undefined) return value
  return w.type === 'button' ? '' : w.value
}

export const textOf = (w: Widget, entered: Entered): string => asText(valueOf(w, entered))
export const listOf = (w: Widget, entered: Entered): string[] => asList(valueOf(w, entered))

export const asText = (v: FieldValue): string => (typeof v === 'string' ? v : v.join('\n'))
export const asList = (v: FieldValue): string[] => (typeof v === 'string' ? (v ? [v] : []) : v)

export function isChecked(w: CheckWidget, entered: Entered): boolean {
  return textOf(w, entered) === w.on
}

/** The value after the user clicks a checkbox or radio button. A radio button stays selected. */
export function click(w: CheckWidget, entered: Entered): string {
  return w.type === 'checkbox' && isChecked(w, entered) ? OFF : w.on
}

export function sameValue(a: FieldValue, b: FieldValue): boolean {
  const x = asList(a)
  const y = asList(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/** The value to store for an edit: nothing when it equals the PDF's own, so untouched fields stay untouched. */
export function toStore(w: Widget, value: FieldValue): FieldValue | null {
  return w.type === 'button' || sameValue(value, w.value) ? null : value
}

const MAX_AUTO_SIZE = 12
const MIN_AUTO_SIZE = 5
const MULTILINE_AUTO_SIZE = 10

/** Font size in points. Mirrors how viewers size text when the field's font size is 0 (automatic). */
export function fontSizeOf(w: TextWidget | ChoiceWidget): number {
  if (w.fontSize > 0) return w.fontSize
  if (w.type === 'text' && w.multiline) return MULTILINE_AUTO_SIZE
  const room = w.rect.h - 2 * w.border.width
  return Math.max(MIN_AUTO_SIZE, Math.min(MAX_AUTO_SIZE, Math.round(room / 1.2)))
}

import { OFF, isChecked, isInteractive, listOf, textOf, type Border, type Entered, type FontFamily, type Widget } from '../model/forms'
import type { PageSize, Rotation, Source } from '../model/types'
import { openPdf } from './pdfjs'

/** The parts of a pdf.js widget annotation that matter here. */
export interface RawWidget {
  subtype?: string
  id: string
  rect: number[]
  fieldName?: string
  fieldType?: string
  fieldFlags?: number
  fieldValue?: unknown
  annotationFlags?: number
  hidden?: boolean
  readOnly?: boolean
  alternativeText?: string
  rotation?: number
  borderStyle?: { width?: number; style?: number }
  borderColor?: ArrayLike<number> | null
  backgroundColor?: ArrayLike<number> | null
  defaultAppearanceData?: { fontSize?: number; fontName?: string; fontColor?: ArrayLike<number> }
  multiLine?: boolean
  password?: boolean
  comb?: boolean
  maxLen?: number
  textAlignment?: number
  options?: { exportValue: string; displayValue: string }[]
  combo?: boolean
  multiSelect?: boolean
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  exportValue?: string
  buttonValue?: string | null
}

/** Converts PDF user space to the unrotated page in points, origin top left. */
interface Viewport {
  convertToViewportPoint(x: number, y: number): number[]
}

const FLAG_HIDDEN = 2
const FLAG_NO_VIEW = 32
const FIELD_REQUIRED = 1 << 1
const FIELD_EDITABLE = 1 << 18
const BORDER_DASHED = 2
const BORDER_UNDERLINE = 5

export function toWidgets(annotations: RawWidget[], viewport: Viewport): Widget[] {
  return annotations.flatMap((a) => {
    if (a.subtype !== 'Widget' || a.hidden || (a.annotationFlags ?? 0) & (FLAG_HIDDEN | FLAG_NO_VIEW)) return []
    const widget = toWidget(a, viewport)
    return widget ? [widget] : []
  })
}

function toWidget(a: RawWidget, viewport: Viewport): Widget | null {
  const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1])
  const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3])
  const name = a.fieldName ?? ''
  const flags = a.fieldFlags ?? 0
  const label = a.alternativeText || name.split('.').pop() || name
  const base = {
    id: a.id,
    name,
    label,
    rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) },
    turn: (((Math.round((a.rotation ?? 0) / 90) * 90) % 360) + 360) % 360 as Rotation,
    // A field without a name cannot be stored or exported, so it is shown but not editable.
    readOnly: !!a.readOnly || !name,
    required: !!(flags & FIELD_REQUIRED),
    border: borderOf(a),
    background: cssColor(a.backgroundColor),
  }
  const font = a.defaultAppearanceData
  const typeset = {
    fontSize: font?.fontSize ?? 0,
    font: familyOf(font?.fontName),
    color: cssColor(font?.fontColor) ?? '#000000',
  }
  switch (a.fieldType) {
    case 'Tx':
      return {
        ...base,
        ...typeset,
        type: 'text',
        value: toText(a.fieldValue),
        multiline: !!a.multiLine,
        password: !!a.password,
        comb: !!a.comb && !!a.maxLen,
        maxLength: a.maxLen ?? 0,
        align: a.textAlignment === 1 ? 'center' : a.textAlignment === 2 ? 'right' : 'left',
      }
    case 'Ch':
      return {
        ...base,
        ...typeset,
        type: 'choice',
        value: toList(a.fieldValue),
        options: (a.options ?? []).map((o) => ({ value: o.exportValue, label: o.displayValue })),
        combo: !!a.combo,
        editable: !!a.combo && !!(flags & FIELD_EDITABLE),
        multiple: !!a.multiSelect,
      }
    case 'Btn': {
      const value = toText(a.fieldValue) || OFF
      if (a.checkBox) return { ...base, type: 'checkbox', on: a.exportValue || 'Yes', value }
      // Without an on-state there is nothing to select.
      if (a.radioButton && a.buttonValue) {
        return { ...base, type: 'radio', on: a.buttonValue, value, label: `${label}: ${a.buttonValue}` }
      }
      return { ...base, type: 'button', readOnly: true }
    }
    default:
      // Signature fields are drawn with the page.
      return null
  }
}

function toText(v: unknown): string {
  if (typeof v === 'string') return v
  return Array.isArray(v) ? v.join('\n') : ''
}

function toList(v: unknown): string[] {
  if (typeof v === 'string') return v ? [v] : []
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
}

function borderOf(a: RawWidget): Border {
  const width = a.borderStyle?.width ?? 1
  const color = cssColor(a.borderColor)
  const style = a.borderStyle?.style
  return {
    width: color ? width : 0,
    color,
    style: style === BORDER_DASHED ? 'dashed' : style === BORDER_UNDERLINE ? 'underline' : 'solid',
  }
}

function cssColor(c: ArrayLike<number> | null | undefined): string | null {
  if (!c || c.length < 3) return null
  return `rgb(${c[0]} ${c[1]} ${c[2]})`
}

function familyOf(name: string | undefined): FontFamily {
  if (!name) return 'sans'
  if (/cour|mono/i.test(name)) return 'mono'
  if (/times|tiro|serif|georgia|garamond|palatino/i.test(name)) return 'serif'
  return 'sans'
}

export interface PageForm {
  /** The page's own /Rotate. */
  rotate: number
  /** The page as drawn in the file, before any rotation, in points. */
  raw: PageSize
  widgets: Widget[]
  /** True when the page has anything to fill in. */
  interactive: boolean
}

const forms = new Map<string, Promise<PageForm>>()

/** The form fields of a page of a PDF, cached per page. */
export function pageForm(source: Source, index: number): Promise<PageForm> {
  const key = `${source.id}:${index}`
  let form = forms.get(key)
  if (!form) {
    form = (async () => {
      const page = await (await openPdf(source)).getPage(index + 1)
      const viewport = page.getViewport({ scale: 1, rotation: 0 })
      const widgets = toWidgets(await page.getAnnotations(), viewport)
      return {
        rotate: page.rotate,
        raw: { width: viewport.width, height: viewport.height },
        widgets,
        interactive: widgets.some(isInteractive),
      }
    })()
    form.catch(() => forms.delete(key))
    forms.set(key, form)
  }
  return form
}

/**
 * What pdf.js has to draw into the fields of a page to show the entered values, by widget id,
 * or null when nothing on the page was filled in.
 */
export async function pageEntries(source: Source, index: number, entered: Entered): Promise<Map<string, unknown> | null> {
  if (!entered || source.kind !== 'pdf') return null
  const { widgets } = await pageForm(source, index)
  if (!widgets.some((w) => w.name in entered)) return null
  return new Map(widgets.filter(isInteractive).map((w) => [w.id, storageValue(w, entered)] as const))
}

/** The shape pdf.js reads from its annotation storage for each kind of field. */
export function storageValue(w: Widget, entered: Entered): string | string[] | boolean {
  switch (w.type) {
    case 'checkbox':
    case 'radio':
      return isChecked(w, entered)
    case 'choice':
      return w.combo ? (listOf(w, entered)[0] ?? '') : listOf(w, entered)
    default:
      return textOf(w, entered)
  }
}

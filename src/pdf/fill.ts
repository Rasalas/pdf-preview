import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFStream,
  PDFTextField,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFField,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { OFF, asList, asText, type FieldValue } from '../model/forms'
import { encodable } from './encodable'

const FLAG_HIDDEN = 2
const FLAG_NO_VIEW = 32

/**
 * Writes entered values into the form of `doc` and flattens it: every widget's appearance
 * becomes page content, so all viewers show the values. Returns the names of fields it could not fill.
 */
export async function fillForm(doc: PDFDocument, values: Record<string, FieldValue>): Promise<string[]> {
  const form = doc.getForm()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fields = new Map(form.getFields().map((f) => [f.getName(), f]))
  const skipped: string[] = []
  for (const [name, value] of Object.entries(values)) {
    const field = fields.get(name)
    try {
      if (!field || !setValue(field, value, font)) skipped.push(name)
    } catch (e) {
      console.warn(`Feld „${name}“ konnte nicht ausgefüllt werden`, e)
      skipped.push(name)
    }
  }
  for (const field of fields.values()) {
    if (!field.needsAppearancesUpdate()) continue
    try {
      field.defaultUpdateAppearances(font)
    } catch (e) {
      console.warn(`Aussehen von „${field.getName()}“ konnte nicht erzeugt werden`, e)
    }
  }
  flattenWidgets(doc)
  return skipped
}

/** Returns false when the field has no place for the value. */
function setValue(field: PDFField, value: FieldValue, font: PDFFont): boolean {
  if (field instanceof PDFTextField) {
    // A password would end up readable in the page content.
    if (field.isPassword() || field.isReadOnly()) return false
    const text = asText(value).replace(/\r\n?/g, '\n')
    const lines = (field.isMultiline() ? text.split('\n') : [text.replace(/\n/g, ' ')]).map((l) => encodable(font, l))
    field.setText(lines.join('\n').slice(0, field.getMaxLength()) || undefined)
    return true
  }
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
    return setChoice(field, asText(value))
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const labels = asList(value).map((v) => encodable(font, labelOf(field, v)))
    if (labels.length === 0) field.clear()
    else field.select(labels)
    return true
  }
  return false
}

/** The text shown for an export value; free text typed into an editable dropdown stands for itself. */
function labelOf(field: PDFDropdown | PDFOptionList, value: string): string {
  const option = field.acroField.getOptions().find((o) => o.value.decodeText() === value)
  return (option?.display ?? option?.value)?.decodeText() ?? value
}

/**
 * Selects a state of a checkbox or radio group by its export value, keeping the authored appearances.
 * The export value is the entry of /Opt for the widget, or the name of its on-state without one.
 */
function setChoice(field: PDFCheckBox | PDFRadioGroup, value: string): boolean {
  const widgets = field.acroField.getWidgets()
  const exports = field.acroField.getExportValues()
  const exportOf = (i: number) => (exports?.[i] ?? widgets[i].getOnValue())?.decodeText()
  const chosen = !value || value === OFF ? undefined : widgets.findIndex((_, i) => exportOf(i) === value)
  const state = chosen === undefined ? PDFName.of(OFF) : widgets[chosen]?.getOnValue()
  if (!state) return false
  field.acroField.dict.set(PDFName.of('V'), state)
  for (const w of widgets) w.setAppearanceState(w.getOnValue() === state ? state : PDFName.of(OFF))
  return true
}

/**
 * Matrix that places an appearance stream in its annotation's rectangle (PDF 32000-1, 12.5.5):
 * the transformed bounding box is scaled and moved onto the rectangle.
 */
export function appearanceMatrix(rect: number[], bbox: number[], matrix: number[]): number[] {
  const [a, b, c, d, e, f] = matrix
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const [rx, ry] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3])]
  const sx = Math.max(...xs) - x0 ? Math.abs(rect[2] - rect[0]) / (Math.max(...xs) - x0) : 1
  const sy = Math.max(...ys) - y0 ? Math.abs(rect[3] - rect[1]) / (Math.max(...ys) - y0) : 1
  return [sx, 0, 0, sy, rx - sx * x0, ry - sy * y0]
}

/**
 * Draws the current appearance of every widget into its page and removes the widget.
 * Unlike pdf-lib's own flatten, it copes with checkboxes without an "Off" appearance and with
 * appearances whose bounding box does not start at the origin.
 */
function flattenWidgets(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    const widgets: { dict: PDFDict; index: number }[] = []
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookupMaybe(i, PDFDict)
      if (dict?.get(PDFName.of('Subtype')) === PDFName.of('Widget')) widgets.push({ dict, index: i })
    }
    if (widgets.length === 0) continue
    const draws = widgets.flatMap(({ dict }) => drawWidget(page, dict))
    if (draws.length) isolateContent(doc, page)
    for (const ops of draws) page.pushOperators(...ops)
    for (const { index } of widgets.reverse()) annots.remove(index)
  }
}

function drawWidget(page: PDFPage, widget: PDFDict) {
  const flags = widget.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
  if (flags & (FLAG_HIDDEN | FLAG_NO_VIEW)) return []
  const rect = numbers(widget.lookupMaybe(PDFName.of('Rect'), PDFArray))
  const found = appearanceOf(widget)
  if (!found || rect?.length !== 4) return []
  const bbox = numbers(found.dict.lookupMaybe(PDFName.of('BBox'), PDFArray)) ?? [0, 0, Math.abs(rect[2] - rect[0]), Math.abs(rect[3] - rect[1])]
  const matrix = numbers(found.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)) ?? [1, 0, 0, 1, 0, 0]
  const key = page.node.newXObject('FlatWidget', found.ref)
  const [a, b, c, d, e, f] = appearanceMatrix(rect, bbox, matrix)
  return [[pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f), drawObject(key), popGraphicsState()]]
}

/** The stream of the widget's normal appearance for its current state. */
function appearanceOf(widget: PDFDict): { ref: PDFRef; dict: PDFDict } | undefined {
  const normal = widget.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'))
  const context = widget.context
  let target = normal
  if (target instanceof PDFRef && context.lookup(target) instanceof PDFDict) {
    target = context.lookup(target)
  }
  if (target instanceof PDFDict) {
    const state = widget.lookupMaybe(PDFName.of('AS'), PDFName)
    target = state ? target.get(state) : undefined
  }
  if (!(target instanceof PDFRef)) return undefined
  const stream = context.lookup(target)
  return stream instanceof PDFStream ? { ref: target, dict: stream.dict } : undefined
}

const numbers = (array: PDFArray | undefined) => array?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0))

/** Existing content may leave its graphics state changed; ours must not inherit that. */
function isolateContent(doc: PDFDocument, page: PDFPage) {
  page.node.normalize()
  const ctx = doc.context
  page.node.wrapContentStreams(ctx.register(ctx.contentStream([pushGraphicsState()])), ctx.register(ctx.contentStream([popGraphicsState()])))
}

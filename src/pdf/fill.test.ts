import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { FieldValues } from '../model/forms'
import type { Page, Source } from '../model/types'
import { buildPdf } from './export'
import { appearanceMatrix, fillForm } from './fill'

async function makeForm() {
  const doc = await PDFDocument.create()
  const form = doc.getForm()
  const page = doc.addPage([300, 400])
  const box = { width: 120, height: 20, borderWidth: 1 }
  form.createTextField('name').addToPage(page, { x: 10, y: 350, ...box })
  const note = form.createTextField('note')
  note.enableMultiline()
  note.addToPage(page, { x: 10, y: 280, width: 120, height: 60, borderWidth: 1 })
  const zip = form.createTextField('zip')
  zip.setMaxLength(5)
  zip.addToPage(page, { x: 10, y: 250, ...box })
  form.createCheckBox('agree').addToPage(page, { x: 10, y: 220, width: 16, height: 16, borderWidth: 1 })
  const radio = form.createRadioGroup('size')
  radio.addOptionToPage('Klein', page, { x: 10, y: 190, width: 16, height: 16, borderWidth: 1 })
  radio.addOptionToPage('Gross', page, { x: 50, y: 190, width: 16, height: 16, borderWidth: 1 })
  const country = form.createDropdown('land')
  country.addOptions(['Deutschland', 'Österreich'])
  country.addToPage(page, { x: 10, y: 150, ...box })
  const hobbies = form.createOptionList('hobby')
  hobbies.addOptions(['Lesen', 'Kochen', 'Musik'])
  hobbies.enableMultiselect()
  hobbies.addToPage(page, { x: 10, y: 80, width: 120, height: 60, borderWidth: 1 })
  doc.addPage([100, 100])
  return doc.save()
}

const source = async (): Promise<Source> => ({
  id: 'form',
  name: 'form.pdf',
  kind: 'pdf',
  mime: 'application/pdf',
  bytes: await makeForm(),
  pages: [{ width: 300, height: 400 }, { width: 100, height: 100 }],
})

const pages: Page[] = [{ id: 'p', sourceId: 'form', index: 0, rotation: 0 }]

/** Strings drawn with Tj in any content or appearance stream (WinAnsi, as Helvetica is embedded by pdf-lib). */
function shownText(doc: PDFDocument): string[] {
  const ansi = new TextDecoder('windows-1252')
  const shown: string[] = []
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    const content = ansi.decode(decodePDFRawStream(object).decode())
    for (const [, hex] of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      shown.push(ansi.decode(Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16))))
    }
  }
  return shown
}

const widgetCount = (doc: PDFDocument) =>
  doc.getPages().reduce((n, p) => {
    const annots = p.node.Annots()
    let widgets = 0
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      if (annots!.lookup(i, PDFDict).get(PDFName.of('Subtype')) === PDFName.of('Widget')) widgets++
    }
    return n + widgets
  }, 0)

describe('buildPdf with form values', () => {
  it('writes the values into the page and drops the widgets', async () => {
    const src = await source()
    const fields: FieldValues = {
      form: {
        name: 'Jürgen Müller',
        note: 'Zeile 1\nZeile 2 € ✓',
        zip: '506678',
        agree: 'Yes',
        size: 'Gross',
        land: 'Österreich',
        hobby: ['Lesen', 'Musik'],
      },
    }
    const out = await PDFDocument.load(await buildPdf(pages, { form: src }, 'Test', undefined, { fields }))

    expect(out.getPageCount()).toBe(1)
    expect(widgetCount(out)).toBe(0)
    const text = shownText(out)
    expect(text).toContain('Jürgen Müller')
    // Not encodable in WinAnsi: "✓" becomes "?", the euro sign survives.
    expect(text).toContain('2 € ?')
    expect(text).toContain('50667')
    expect(text).toContain('Österreich')
    expect(text).toContain('Lesen')
    expect(text).toContain('Musik')
    // One appearance per widget
    expect(out.getPage(0).node.normalizedEntries().XObject.keys().length).toBe(8)
  })

  it('leaves the cached document and unfilled sources as they were', async () => {
    const src = await source()
    const filled = await buildPdf(pages, { form: src }, 'Test', undefined, { fields: { form: { name: 'A' } } })
    expect(widgetCount(await PDFDocument.load(filled))).toBe(0)

    const plain = await PDFDocument.load(await buildPdf(pages, { form: src }, 'Test'))
    expect(widgetCount(plain)).toBe(7 + 1)
    const empty = await PDFDocument.load(await buildPdf(pages, { form: src }, 'Test', undefined, { fields: { form: {} } }))
    expect(widgetCount(empty)).toBe(7 + 1)
  })

  it('reports the fields it could not fill', async () => {
    const doc = await PDFDocument.load(await makeForm())
    const skipped = await fillForm(doc, { gibtsnicht: 'x', size: 'Riesig', agree: 'Vielleicht', name: 'Eva', land: 'Gross', size2: 'Klein' })
    // A free text in a dropdown that is not editable just selects it, so only the first three fail.
    expect(skipped).toEqual(['gibtsnicht', 'size', 'agree', 'size2'])
  })

  it('selects the radio button with the given export value', async () => {
    const doc = await PDFDocument.load(await makeForm())
    expect(await fillForm(doc, { size: 'Gross' })).toEqual([])
  })

  it('keeps going when a field is unknown or the value does not fit', async () => {
    const src = await source()
    const out = await PDFDocument.load(
      await buildPdf(pages, { form: src }, 'Test', undefined, { fields: { form: { gibtsnicht: 'x', size: 'Riesig', name: 'Eva' } } }),
    )
    expect(shownText(out)).toContain('Eva')
    expect(widgetCount(out)).toBe(0)
  })

  it('unchecks a pre-checked box and clears a dropdown', async () => {
    const doc = await PDFDocument.load(await makeForm())
    doc.getForm().getCheckBox('agree').check()
    doc.getForm().getDropdown('land').select('Deutschland')
    const src: Source = { ...(await source()), bytes: await doc.save() }
    const out = await PDFDocument.load(
      await buildPdf(pages, { form: src }, 'Test', undefined, { fields: { form: { agree: 'Off', land: [] } } }),
    )
    expect(shownText(out)).not.toContain('Deutschland')
  })
})

describe('appearanceMatrix', () => {
  it('moves an appearance with its origin at zero onto the rectangle', () => {
    expect(appearanceMatrix([100, 200, 220, 220], [0, 0, 120, 20], [1, 0, 0, 1, 0, 0])).toEqual([1, 0, 0, 1, 100, 200])
  })

  it('scales a bounding box that differs from the rectangle and does not start at zero', () => {
    expect(appearanceMatrix([10, 10, 30, 50], [5, 5, 15, 25], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 0, 0])
  })

  it('takes the form matrix into account, e.g. a quarter turn', () => {
    // 20 x 120 box turned by 90 degrees fills a 120 x 20 rectangle exactly
    const m = appearanceMatrix([0, 0, 20, 120], [0, 0, 120, 20], [0, 1, -1, 0, 20, 0])
    expect(m).toEqual([1, 0, 0, 1, 0, 0])
  })
})

// Fictional sample documents for screenshots and videos, so no real data ends up in marketing material.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ink = rgb(0.12, 0.12, 0.11)
const muted = rgb(0.45, 0.45, 0.42)
const accent = rgb(0.02, 0.59, 0.41)
const line = rgb(0.86, 0.86, 0.83)

async function offer() {
  const doc = await PDFDocument.create()
  doc.setTitle('Angebot Website-Relaunch')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const text = (page, s, x, y, size = 10, font = regular, color = ink) => page.drawText(s, { x, y, size, font, color })

  const page = doc.addPage([595.28, 841.89])
  page.drawRectangle({ x: 0, y: 801.89, width: 595.28, height: 40, color: accent })
  text(page, 'Studio Lindenhof', 48, 816, 14, bold, rgb(1, 1, 1))
  text(page, 'Gestaltung & Entwicklung · Münster', 380, 817, 9, regular, rgb(1, 1, 1))
  text(page, 'Stadtbibliothek Beispielstadt', 48, 740)
  text(page, 'z. Hd. Frau Petra Sommer', 48, 726)
  text(page, 'Am Markt 12, 48143 Münster', 48, 712)
  text(page, 'Münster, 10. Oktober 2026', 420, 740, 10, regular, muted)
  text(page, 'Angebot Nr. 2026-117', 48, 660, 20, bold)
  text(page, 'Relaunch der Website mit barrierefreiem Katalogzugang', 48, 638, 12, regular, muted)
  const intro = [
    'Sehr geehrte Frau Sommer,',
    '',
    'vielen Dank für das freundliche Gespräch. Gern bieten wir Ihnen die Neugestaltung',
    'Ihrer Website an. Der Schwerpunkt liegt auf einer klaren Suche im Katalog, kurzen',
    'Ladezeiten und einer Bedienung, die auch mit Screenreader und Tastatur gelingt.',
  ]
  intro.forEach((l, i) => text(page, l, 48, 600 - i * 15))

  const rows = [
    ['1', 'Workshop und Konzept', '2 Tage', '2.400,00 €'],
    ['2', 'Gestaltung, Prototyp und Nutzertest', '6 Tage', '7.200,00 €'],
    ['3', 'Umsetzung und Katalog-Anbindung', '12 Tage', '14.400,00 €'],
    ['4', 'Barrierefreiheitsprüfung (WCAG 2.2 AA)', '2 Tage', '2.400,00 €'],
    ['5', 'Schulung der Redaktion', '1 Tag', '1.200,00 €'],
  ]
  let y = 500
  page.drawLine({ start: { x: 48, y: y + 16 }, end: { x: 547, y: y + 16 }, thickness: 0.8, color: line })
  for (const [n, label, days, price] of [['Pos.', 'Leistung', 'Aufwand', 'Betrag'], ...rows]) {
    const head = n === 'Pos.'
    const f = head ? bold : regular
    text(page, n, 48, y, 10, f, head ? muted : ink)
    text(page, label, 84, y, 10, f, head ? muted : ink)
    text(page, days, 380, y, 10, f, head ? muted : ink)
    text(page, price, 547 - f.widthOfTextAtSize(price, 10), y, 10, f, head ? muted : ink)
    y -= 24
    page.drawLine({ start: { x: 48, y: y + 16 }, end: { x: 547, y: y + 16 }, thickness: 0.5, color: line })
  }
  const total = (label, value, f = regular) => {
    text(page, label, 380, y, 10, f)
    text(page, value, 547 - f.widthOfTextAtSize(value, 10), y, 10, f)
    y -= 18
  }
  y -= 6
  total('Summe netto', '27.600,00 €')
  total('zzgl. 19 % USt.', '5.244,00 €')
  total('Gesamtbetrag', '32.844,00 €', bold)
  text(page, 'Das Angebot gilt bis zum 30. November 2026.', 48, 220, 10, regular, muted)
  text(page, 'Mit freundlichen Grüßen', 48, 180)
  page.drawLine({ start: { x: 48, y: 120 }, end: { x: 220, y: 120 }, thickness: 0.6, color: muted })
  text(page, 'Jonas Lindner, Studio Lindenhof', 48, 106, 9, regular, muted)

  const terms = doc.addPage([595.28, 841.89])
  text(terms, 'Leistungsbeschreibung und Bedingungen', 48, 770, 16, bold)
  const paragraphs = [
    ['Zeitplan', 'Start nach Auftragserteilung, Livegang nach etwa zehn Wochen.'],
    ['Abnahme', 'Jede Phase endet mit einer gemeinsamen Abnahme der Ergebnisse.'],
    ['Zahlung', '30 % bei Auftrag, 40 % nach Gestaltung, 30 % nach Livegang.'],
    ['Hosting', 'Betrieb auf Servern Ihrer Wahl; auf Wunsch übernehmen wir die Wartung.'],
    ['Nutzungsrechte', 'Alle Rechte an Gestaltung und Code gehen mit Zahlung auf Sie über.'],
  ]
  paragraphs.forEach(([h, body], i) => {
    text(terms, h, 48, 720 - i * 56, 11, bold)
    text(terms, body, 48, 702 - i * 56, 10, regular, muted)
  })
  return doc.save()
}

async function plan() {
  const doc = await PDFDocument.create()
  doc.setTitle('Projektplan')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([841.89, 595.28])
  page.drawText('Projektplan Website-Relaunch', { x: 48, y: 540, size: 20, font: bold, color: ink })
  page.drawText('Kalenderwochen 44 bis 53', { x: 48, y: 518, size: 11, font: regular, color: muted })
  const phases = [
    ['Konzept', 0, 2, rgb(0.17, 0.49, 0.91)],
    ['Gestaltung', 2, 3, rgb(0.54, 0.31, 0.85)],
    ['Umsetzung', 4, 5, accent],
    ['Prüfung', 8, 1, rgb(0.95, 0.55, 0.16)],
    ['Livegang', 9, 1, rgb(0.9, 0.22, 0.23)],
  ]
  const x0 = 170
  const col = 62
  for (let w = 0; w < 10; w++) {
    page.drawText(`KW ${44 + w}`, { x: x0 + w * col + 14, y: 470, size: 9, font: regular, color: muted })
    page.drawLine({ start: { x: x0 + w * col, y: 120 }, end: { x: x0 + w * col, y: 485 }, thickness: 0.5, color: line })
  }
  phases.forEach(([name, start, len, color], i) => {
    const y = 420 - i * 62
    page.drawText(name, { x: 48, y: y + 10, size: 12, font: bold, color: ink })
    page.drawRectangle({ x: x0 + start * col + 4, y, width: len * col - 8, height: 30, color, opacity: 0.9 })
  })
  return doc.save()
}

/** Renders a photo-like whiteboard image in the browser, since Node has no canvas. */
export async function whiteboardJpeg(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1600
    c.height = 1200
    const g = c.getContext('2d')
    const bg = g.createLinearGradient(0, 0, 1600, 1200)
    bg.addColorStop(0, '#f4f2ec')
    bg.addColorStop(1, '#dedad0')
    g.fillStyle = bg
    g.fillRect(0, 0, 1600, 1200)
    const notes = [
      ['#ffe066', 'Suche\nzuerst!', 160, 180, -4],
      ['#8ce99a', 'Kontrast\nprüfen', 560, 140, 3],
      ['#74c0fc', 'Katalog-\nAPI', 960, 210, -2],
      ['#ffa8a8', 'Termin\nKW 53', 1260, 160, 4],
      ['#ffe066', 'Tastatur-\nbedienung', 330, 640, 2],
      ['#d0bfff', 'Leichte\nSprache', 820, 660, -3],
    ]
    for (const [color, label, x, y, rot] of notes) {
      g.save()
      g.translate(x + 140, y + 140)
      g.rotate((rot * Math.PI) / 180)
      g.shadowColor = 'rgba(0,0,0,0.25)'
      g.shadowBlur = 24
      g.shadowOffsetY = 10
      g.fillStyle = color
      g.fillRect(-140, -140, 280, 280)
      g.shadowColor = 'transparent'
      g.fillStyle = '#2b2b2b'
      g.font = '600 46px "Marker Felt", "Comic Sans MS", cursive'
      label.split('\n').forEach((l, i) => g.fillText(l, -110, -30 + i * 60))
      g.restore()
    }
    g.strokeStyle = '#2b7de9'
    g.lineWidth = 8
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(450, 470)
    g.quadraticCurveTo(620, 560, 780, 520)
    g.stroke()
    return c.toDataURL('image/jpeg', 0.88)
  })
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

export async function writeDemoFiles(dir, page) {
  await mkdir(dir, { recursive: true })
  const files = {
    offer: join(dir, 'Angebot Website-Relaunch.pdf'),
    plan: join(dir, 'Projektplan.pdf'),
    photo: join(dir, 'Whiteboard.jpg'),
  }
  await writeFile(files.offer, await offer())
  await writeFile(files.plan, await plan())
  await writeFile(files.photo, await whiteboardJpeg(page))
  return files
}

// Regenerates the screenshots and the demo video in docs/media from the current code.
// Usage: npm run media            (screenshots and video)
//        npm run media -- --no-video
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { build, preview } from 'vite'
import { writeDemoFiles } from './demo-files.mjs'

const root = resolve(import.meta.dirname, '../..')
const out = join(root, 'docs/media')
const withVideo = !process.argv.includes('--no-video')

await build({ root, logLevel: 'warn' })
const server = await preview({ root, preview: { port: 4317, strictPort: true }, logLevel: 'warn' })
const url = 'http://localhost:4317/'
let browser

try {
  browser = await chromium.launch()
  await mkdir(out, { recursive: true })
  const scratch = await browser.newPage()
  const files = await writeDemoFiles(join(tmpdir(), 'pdf-preview-media'), scratch)
  await scratch.close()

  await screenshots(files)
  await phone(files)
  if (withVideo) await video(files)
} finally {
  await browser?.close()
  await server.close()
}

async function screenshots(files) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE' })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForSelector('.empty h1')
  await page.waitForTimeout(1200) // let the entrance animation finish
  await shot(page, 'start')

  await page.setInputFiles('input[type=file]', [files.offer, files.photo, files.plan])
  await settle(page, 4)
  await page.keyboard.press('ControlOrMeta+Shift+a')
  await fitPage(page)
  await page.locator('.thumb').first().click()
  await annotate(page)
  await select(page, 'Auswählen (Text und Markierungen)')
  await page.locator('.thumb').first().click()
  await settle(page, 4)
  await shot(page, 'hero')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(300)
  await shot(page, 'dark')
  await page.emulateMedia({ colorScheme: 'light' })

  await page.fill('input[type=search]', 'Katalog')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.viewer mark.hit.is-active')
  await page.waitForTimeout(400)
  await shot(page, 'search')
  await page.fill('input[type=search]', '')

  // Freeze the sidebar mid-drag so the insertion marker is visible.
  await page.locator('.thumb').nth(2).click()
  await page.locator('.thumb').nth(3).click({ modifiers: ['ControlOrMeta'] })
  await page.evaluate(() => {
    const list = document.querySelector('.sidebar-list')
    const target = document.querySelectorAll('.thumb')[1].getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-vorschau-pages', 'x')
    list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: target.left + 50, clientY: target.top + 4, dataTransfer }))
  })
  await page.waitForTimeout(200)
  await shot(page, 'reorder')
  await context.close()
}

async function phone(files) {
  const { devices } = await import('playwright')
  const context = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 3, locale: 'de-DE' })
  const page = await context.newPage()
  await page.goto(url)
  await page.setInputFiles('input[type=file]', [files.offer, files.photo, files.plan])
  await settle(page, 0)
  await page.waitForFunction(() => document.querySelector('.viewer-page canvas')?.width > 0)
  await page.tap('button[aria-label="Markieren"]')
  await page.tap('.markup-bar button[aria-label="Text hervorheben"]')
  const heading = page.locator('.viewer-page').first().locator('.textLayer span', { hasText: 'Angebot Nr.' })
  await heading.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  // Re-choosing the highlighter applies it to the selection, as a tap on a phone would.
  await page.tap('.markup-bar button[aria-label="Auswählen (Text und Markierungen)"]')
  await page.tap('.markup-bar button[aria-label="Text hervorheben"]')
  await page.tap('.markup-bar button[aria-label="Auswählen (Text und Markierungen)"]')
  await page.waitForTimeout(400)
  await shot(page, 'phone-markup')
  await page.tap('.markup-done')
  await page.tap('button[aria-label="Seitenübersicht"]')
  await page.waitForFunction(() => document.querySelectorAll('.pages-panel .thumb img').length >= 4)
  await page.tap('.pages-panel-head button')
  await page.locator('.pages-panel .thumb').nth(2).tap()
  await page.locator('.pages-panel .thumb').nth(3).tap()
  await page.waitForTimeout(300)
  await shot(page, 'phone-pages')
  await context.close()
}

async function video(files) {
  const dir = join(tmpdir(), 'pdf-preview-video')
  await rm(dir, { recursive: true, force: true })
  const size = { width: 1280, height: 800 }
  const context = await browser.newContext({ viewport: size, locale: 'de-DE', recordVideo: { dir, size } })
  await context.addInitScript(fakeCursor)
  const page = await context.newPage()
  const pause = (ms) => page.waitForTimeout(ms)

  await page.goto(url)
  await page.waitForSelector('.empty h1')
  await glide(page, 640, 560)
  await pause(1200)
  // Show the drop overlay, then hand over the files as if they were dropped.
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([''], 'x.pdf', { type: 'application/pdf' }))
    document.querySelector('.workspace').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
  })
  await pause(900)
  await page.setInputFiles('input[type=file]', [files.offer, files.photo, files.plan])
  await page.evaluate(() => document.querySelector('.workspace').dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null })))
  await settle(page, 4)
  await pause(1200)

  // Move the photo to the end of the document.
  await page.locator('.thumb').first().click()
  await pause(400)
  const photo = page.locator('.thumb').nth(2)
  const from = await photo.boundingBox()
  await glide(page, from.x + from.width / 2, from.y + from.height / 2)
  await photo.click()
  await page.mouse.down()
  const last = await page.locator('.thumb').nth(3).boundingBox()
  await glide(page, last.x + last.width / 2, last.y + last.height * 0.85, 40)
  await page.mouse.up()
  await pause(900)
  await page.keyboard.press('ControlOrMeta+r')
  await pause(900)

  // Back to page 1 and mark it up.
  const first = await page.locator('.thumb').first().boundingBox()
  await glide(page, first.x + first.width / 2, first.y + first.height / 2)
  await page.locator('.thumb').first().click()
  await pause(600)
  await page.keyboard.press('ControlOrMeta+Shift+a')
  await fitPage(page)
  await page.locator('.thumb').first().click()
  await pause(600)
  await annotate(page, { animate: true })
  await select(page, 'Auswählen (Text und Markierungen)')
  await pause(800)

  await page.click('input[type=search]')
  await page.keyboard.type('Katalog', { delay: 90 })
  await page.keyboard.press('Enter')
  await pause(1600)
  await page.fill('input[type=search]', '')
  await page.keyboard.press('Escape')

  const save = await page.locator('.export-button').boundingBox()
  await glide(page, save.x + save.width / 2, save.y + save.height / 2)
  await page.locator('.export-button').click()
  await pause(1600)
  await page.keyboard.press('Escape')
  await pause(500)

  const recording = page.video()
  await context.close()
  const webm = join(out, 'demo.webm')
  await rename(await recording.path(), webm)
  convert(webm)
}

/** Highlight, arrow, note and signature on the first page. */
async function annotate(page, { animate = false } = {}) {
  const pageBox = () => page.locator('.viewer-page').first().boundingBox()
  const move = (x, y, steps) => (animate ? glide(page, x, y, steps) : page.mouse.move(x, y))
  const pause = (ms) => (animate ? page.waitForTimeout(ms) : null)

  await select(page, 'Text hervorheben', move)
  const heading = page.locator('.viewer-page').first().locator('.textLayer span', { hasText: 'Angebot Nr.' })
  const h = await heading.boundingBox()
  await move(h.x + 1, h.y + h.height / 2)
  await page.mouse.down()
  await move(h.x + h.width - 1, h.y + h.height / 2, 30)
  await page.mouse.up()
  await pause(700)

  await select(page, 'Pfeil', move)
  await select(page, 'Farbe #e5383b', move)
  let box = await pageBox()
  await move(box.x + box.width * 0.7, box.y + box.height * 0.705)
  await page.mouse.down()
  await move(box.x + box.width * 0.79, box.y + box.height * 0.64, 25)
  await page.mouse.up()
  await pause(500)

  await select(page, 'Text', move)
  box = await pageBox()
  await move(box.x + box.width * 0.5, box.y + box.height * 0.735)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.735)
  await page.keyboard.type('Bitte bis Freitag freigeben', { delay: animate ? 55 : 0 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape') // deselect, or the next colour change would recolour the note
  await pause(600)

  await select(page, 'Farbe #1d1d1b', move)
  await select(page, 'Unterschrift', move)
  const existing = page.locator('.signature-item button').first()
  if (await existing.count()) await existing.click()
  else {
    await page.click('.signature-new')
    const pad = await page.locator('.signature-pad').boundingBox()
    const stroke = [
      [60, 130], [80, 70], [95, 140], [118, 82], [135, 135], [160, 100], [190, 128], [215, 92], [240, 126],
      [270, 104], [300, 120], [340, 98], [380, 112],
    ]
    await page.mouse.move(pad.x + stroke[0][0], pad.y + stroke[0][1])
    await page.mouse.down()
    for (const [x, y] of stroke.slice(1)) await page.mouse.move(pad.x + x, pad.y + y, { steps: animate ? 6 : 2 })
    await page.mouse.up()
    await pause(500)
    await page.click('.dialog button:has-text("Sichern")')
  }
  box = await pageBox()
  const spot = [box.x + box.width * 0.2, box.y + box.height * 0.83]
  await move(...spot)
  await page.mouse.click(...spot)
  await page.keyboard.press('Escape')
  await pause(800)
}

async function select(page, label, move = null) {
  const el = page.locator(`.markup-bar button[aria-label="${label}"]`)
  if (move) {
    const b = await el.boundingBox()
    await move(b.x + b.width / 2, b.y + b.height / 2, 18)
  }
  await el.click()
}

/** Zooms out until the first page fits the window, so all markup is in view. */
async function fitPage(page) {
  for (let i = 0; i < 8; i++) {
    const fits = await page.evaluate(() => {
      const viewer = document.querySelector('.viewer').getBoundingClientRect()
      return document.querySelector('.viewer-page').getBoundingClientRect().height + 48 <= viewer.height
    })
    if (fits) return
    await page.keyboard.press('ControlOrMeta+Minus')
    await page.waitForTimeout(250)
  }
}

/** Waits until thumbnails and visible pages have rendered. */
async function settle(page, thumbs) {
  await page.waitForFunction((n) => document.querySelectorAll('.thumb img').length >= n, thumbs, { timeout: 20000 })
  await page.waitForFunction(() => !document.querySelector('.viewer-page.is-loading') || document.querySelectorAll('.viewer-page:not(.is-loading)').length >= 1)
  await page.waitForTimeout(500)
}

async function shot(page, name) {
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log(`docs/media/${name}.png`)
}

/** Moves the mouse in visible steps, since a recorded cursor would otherwise jump. */
async function glide(page, x, y, steps = 28) {
  await page.mouse.move(x, y, { steps })
}

function fakeCursor() {
  // Headless browsers do not render the pointer, so the video gets a drawn one.
  addEventListener('DOMContentLoaded', () => {
    const el = document.createElement('div')
    el.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.6 3.6 6.4-2.6 1.4-3.6-6.4L6 18z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    Object.assign(el.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transition: 'transform 60ms linear' })
    document.body.append(el)
    addEventListener('mousemove', (e) => (el.style.translate = `${e.clientX - 4}px ${e.clientY - 3}px`), true)
    addEventListener('mousedown', () => (el.style.transform = 'scale(0.85)'), true)
    addEventListener('mouseup', () => (el.style.transform = ''), true)
  })
}

function convert(webm) {
  const run = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, ...args])
  try {
    run(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', join(out, 'demo.mp4')])
    run([
      '-vf',
      'fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
      join(out, 'demo.gif'),
    ])
    rmSync(webm)
    console.log('docs/media/demo.mp4\ndocs/media/demo.gif')
  } catch {
    console.warn('ffmpeg nicht gefunden: nur docs/media/demo.webm erzeugt.')
  }
}


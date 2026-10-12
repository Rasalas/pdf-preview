// Chrome and Safari lose a selection that is dragged over blank space between absolutely
// positioned words. pdf.js's viewer cures this with a cover element (.endOfContent) that follows
// the selection's moving end; this is that technique, for the layers of recognised text.

interface Tracked {
  layer: HTMLElement
  end: HTMLElement
  previous: Range | null
}

const isFirefox = /firefox/i.test(navigator.userAgent)
const tracked = new Set<Tracked>()
let pointerDown = false
let installed = false

/** Follows selections in `layer` for as long as it is in the document. */
export function keepSelecting(layer: HTMLElement, end: HTMLElement): void {
  if (!installed) {
    installed = true
    document.addEventListener('selectionchange', onChange)
    document.addEventListener('pointerdown', () => (pointerDown = true))
    document.addEventListener('pointerup', () => {
      pointerDown = false
      each(reset)
    })
    document.addEventListener('keyup', () => pointerDown || each(reset))
    addEventListener('blur', () => each(reset))
  }
  tracked.add({ layer, end, previous: null })
}

// Layers are replaced on every zoom step; the ones that left the document are dropped here.
function each(fn: (t: Tracked) => void) {
  for (const t of tracked) {
    if (t.layer.isConnected) fn(t)
    else tracked.delete(t)
  }
}

function reset(t: Tracked) {
  t.layer.append(t.end)
  t.end.style.width = t.end.style.height = ''
  t.layer.classList.remove('selecting')
  t.previous = null
}

function onChange() {
  const selection = getSelection()
  if (!selection || selection.rangeCount === 0) return each(reset)
  const range = selection.getRangeAt(0)
  each((t) => {
    if (!range.intersectsNode(t.layer)) return reset(t)
    t.layer.classList.add('selecting')
    if (isFirefox) return
    const movesStart = t.previous && (range.compareBoundaryPoints(Range.END_TO_END, t.previous) === 0 || range.compareBoundaryPoints(Range.START_TO_END, t.previous) === 0)
    let anchor: Node | null = movesStart ? range.startContainer : range.endContainer
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
    if (!movesStart && range.endOffset === 0) {
      // The selection ends at the very start of a node; the text it covers ends in the node before.
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
        anchor = anchor?.previousSibling ?? null
      } while (anchor && !anchor.childNodes.length)
    }
    if (anchor?.parentElement?.closest('.ocr-layer') === t.layer) {
      t.end.style.width = t.layer.style.width
      t.end.style.height = t.layer.style.height
      anchor.parentElement.insertBefore(t.end, movesStart ? anchor : anchor.nextSibling)
    }
    t.previous = range.cloneRange()
  })
}

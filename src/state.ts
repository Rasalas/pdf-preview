import { sameValue, type FieldValue, type FieldValues } from './model/forms'
import { commit, createHistory, redo, undo, type History } from './model/history'
import { newId } from './model/ids'
import { clampRect, displayedSize, normalizeCrop, sameCropFor } from './model/crop'
import type { OcrPage, OcrResults } from './model/ocr'
import { cropPages, duplicatePages, insertPages, movePages, normalizeRotation, removePages, rotatePages } from './model/pages'
import { layoutSheet, placeAt } from './model/sheet'
import type { Annotation, Page, Point, Rect, Source, Sources } from './model/types'

export interface State {
  history: History<Page[]>
  sources: Sources
  /**
   * Form fields the user filled in. Kept out of the undo history on purpose: undoing a page
   * operation must never take back typed text, and a field edit is no page edit.
   */
  fields: FieldValues
  /** Text read from scans, by source page. Outside the history for the same reason as `fields`. */
  ocr: OcrResults
  selection: string[]
  anchor: string | null
  /** The page shown in the viewer. */
  current: string | null
  title: string
  /** The selected annotation, if any. */
  markup: { pageId: string; id: string } | null
}

export type Action =
  /** Inserts before the page `before`, or at the end if it is null or gone. */
  | { type: 'import'; sources: Source[]; before: string | null }
  | { type: 'remove' }
  | { type: 'move'; gap: number }
  | { type: 'nudge'; delta: -1 | 1 }
  | { type: 'rotate'; delta: number }
  | { type: 'duplicate' }
  /** Lays the pages `ids` onto a new A4 sheet, which takes the place of the first of them. */
  | { type: 'combine'; ids: string[] }
  /** Lays the pages `ids` onto page `target`, centred on `at` if given (target's own space). Moves them unless `copy`. */
  | { type: 'place'; ids: string[]; target: string; at: Point | null; copy: boolean }
  /** Crops a page (null shows all of it again); the pages in `also` get the same rectangle relative to their size. */
  | { type: 'crop'; pageId: string; crop: Rect | null; also?: string[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; id: string; mode: 'single' | 'toggle' | 'range' }
  | { type: 'selectAll' }
  | { type: 'selectNone' }
  | { type: 'step'; delta: number; extend: boolean }
  | { type: 'scrolledTo'; id: string }
  | { type: 'title'; title: string }
  | { type: 'restore'; title: string; pages: Page[]; sources: Sources; fields?: FieldValues; ocr?: OcrResults }
  | { type: 'ocr'; sourceId: string; index: number; page: OcrPage }
  /** Sets a field of a source; a null value drops the entry so the field shows the PDF's value again. */
  | { type: 'field'; sourceId: string; name: string; value: FieldValue | null }
  | { type: 'annotate'; pageId: string; annotation: Annotation; select?: boolean }
  | { type: 'updateAnnotation'; pageId: string; annotation: Annotation }
  | { type: 'removeAnnotation'; pageId: string; id: string }
  | { type: 'selectAnnotation'; target: { pageId: string; id: string } | null }

export const initialState: State = {
  history: createHistory<Page[]>([]),
  sources: {},
  fields: {},
  ocr: {},
  selection: [],
  anchor: null,
  current: null,
  title: '',
  markup: null,
}

export const pagesOf = (s: State) => s.history.present

export function reducer(state: State, action: Action): State {
  const pages = pagesOf(state)
  const selected = new Set(state.selection)

  switch (action.type) {
    case 'import': {
      const sources = { ...state.sources }
      const added: Page[] = []
      for (const source of action.sources) {
        sources[source.id] = source
        source.pages.forEach((_, index) => added.push({ id: newId(), sourceId: source.id, index, rotation: 0 }))
      }
      if (added.length === 0) return state
      const title = state.title || (pages.length === 0 ? baseName(action.sources[0].name) : '')
      const next = { ...state, sources, title }
      const anchor = action.before ? pages.findIndex((p) => p.id === action.before) : -1
      const at = anchor < 0 ? pages.length : anchor
      return withSelection(edit(next, insertPages(pages, added, at)), added.map((p) => p.id))
    }
    case 'remove': {
      if (selected.size === 0) return state
      const first = pages.findIndex((p) => selected.has(p.id))
      const next = removePages(pages, selected)
      const neighbour = next[Math.min(first, next.length - 1)]
      return withSelection(edit(state, next), neighbour ? [neighbour.id] : [])
    }
    case 'move':
      return edit(state, movePages(pages, selected, action.gap))
    case 'nudge': {
      const indices = pages.flatMap((p, i) => (selected.has(p.id) ? [i] : []))
      if (indices.length === 0) return state
      const gap = action.delta < 0 ? Math.max(0, indices[0] - 1) : Math.min(pages.length, indices.at(-1)! + 2)
      return edit(state, movePages(pages, selected, gap))
    }
    case 'rotate':
      return selected.size ? edit(state, rotatePages(pages, selected, action.delta)) : state
    case 'duplicate': {
      if (selected.size === 0) return state
      const r = duplicatePages(pages, selected, newId)
      return withSelection(edit(state, r.pages), r.copies)
    }
    case 'combine': {
      const ids = new Set(action.ids)
      const chosen = pages.filter((p) => ids.has(p.id))
      if (chosen.length === 0) return state
      const { sheet, page } = newSheet(state, chosen)
      const next = insertPages(removePages(pages, ids), [page], pages.indexOf(chosen[0]))
      return withSelection(edit({ ...state, sources: { ...state.sources, [sheet.id]: sheet } }, next), [page.id])
    }
    case 'place': {
      const host = pages.find((p) => p.id === action.target)
      const moving = pages.filter((p) => action.ids.includes(p.id) && p !== host)
      if (!host || moving.length === 0) return state
      const gone = action.copy ? new Set<string>() : new Set(moving.map((p) => p.id))
      const hostSize = sourceSize(state, host)
      const kind = state.sources[host.sourceId].kind

      // A picture dropped on a picture: both go side by side onto a new sheet, the dropped one first if dropped high.
      if (kind === 'image') {
        const first = action.at !== null && action.at[1] < hostSize.height / 2
        const { sheet, page } = newSheet(state, first ? [...moving, host] : [host, ...moving])
        const next = removePages(pages, gone).map((p) => (p === host ? page : p))
        return withSelection(edit({ ...state, sources: { ...state.sources, [sheet.id]: sheet } }, next), [page.id])
      }

      // Upright on screen, whatever way the host page is turned.
      const laid = moving.map((p) => ({ ...p, rotation: normalizeRotation(p.rotation - host.rotation) }))
      const added = laid.map((p): Annotation & { type: 'page' } => ({ id: newId(), type: 'page', page: p, x: 0, y: 0, w: 0, h: 0 }))
      let annotations: Annotation[]
      if (kind === 'blank') {
        // A sheet keeps its pages apart: all of them are laid out anew, the dropped ones where they were let go.
        const own = (host.annotations ?? []).filter((a) => a.type === 'page')
        const order = readingOrder(own)
        const at = action.at ? order.filter((a) => before(a, action.at!)).length : order.length
        const all = [...order.slice(0, at), ...added, ...order.slice(at)]
        const { places } = layoutSheet(all.map((a) => displayedSize(sourceSize(state, a.page), a.page)), [hostSize])
        const placed = new Map(all.map((a, i) => [a.id, { ...a, ...places[i] }]))
        annotations = [...(host.annotations ?? []).map((a) => placed.get(a.id) ?? a), ...added.map((a) => placed.get(a.id)!)]
      } else {
        // On a document the page goes where it was dropped, like a stamp.
        const sizes = laid.map((p) => displayedSize(sourceSize(state, p), p))
        const rects = action.at && laid.length === 1 ? [placeAt(sizes[0], hostSize, action.at)] : layoutSheet(sizes, [hostSize]).places
        annotations = [...(host.annotations ?? []), ...added.map((a, i) => ({ ...a, ...rects[i] }))]
      }
      const next = removePages(pages, gone).map((p) => (p === host ? { ...p, annotations } : p))
      const markup = added.length === 1 ? { pageId: host.id, id: added[0].id } : null
      return { ...withSelection(edit(state, next), [host.id]), markup }
    }
    case 'crop': {
      const from = pages.find((p) => p.id === action.pageId)
      if (!from) return state
      const sizeOf = (p: Page) => state.sources[p.sourceId].pages[p.index]
      const base = action.crop && clampRect(action.crop, sizeOf(from))
      const crops = new Map<string, Rect | undefined>()
      for (const p of pages) {
        if (p === from) crops.set(p.id, normalizeCrop(base, sizeOf(p)))
        else if (action.also?.includes(p.id)) {
          const view = (q: Page) => ({ size: sizeOf(q), rotation: q.rotation })
          crops.set(p.id, base ? sameCropFor(base, view(from), view(p)) : undefined)
        }
      }
      return edit(state, cropPages(pages, crops))
    }
    case 'undo':
    case 'redo': {
      const history = action.type === 'undo' ? undo(state.history) : redo(state.history)
      if (history === state.history) return state
      const ids = new Set(history.present.map((p) => p.id))
      // Prefer the pages the undone step touched, so the user sees what changed.
      const changed = diffIds(state.history.present, history.present)
      const keep = state.selection.filter((id) => ids.has(id))
      const selection = changed.length ? changed : keep.length ? keep : history.present.slice(0, 1).map((p) => p.id)
      const markup = state.markup && findAnnotation(history.present, state.markup) ? state.markup : null
      return withSelection({ ...state, history, markup }, selection)
    }
    case 'select': {
      if (action.mode === 'toggle') {
        const selection = selected.has(action.id)
          ? state.selection.filter((id) => id !== action.id)
          : [...state.selection, action.id]
        return { ...state, selection, anchor: action.id, current: action.id }
      }
      if (action.mode === 'range' && state.anchor) {
        return { ...state, selection: rangeIds(pages, state.anchor, action.id), current: action.id }
      }
      return { ...state, selection: [action.id], anchor: action.id, current: action.id }
    }
    case 'selectAll':
      return { ...state, selection: pages.map((p) => p.id) }
    case 'selectNone':
      return { ...state, selection: [], anchor: null }
    case 'step': {
      if (pages.length === 0) return state
      const from = pages.findIndex((p) => p.id === (state.current ?? state.anchor))
      const to = pages[Math.min(pages.length - 1, Math.max(0, from + action.delta))]
      if (action.extend && state.anchor) {
        return { ...state, selection: rangeIds(pages, state.anchor, to.id), current: to.id }
      }
      return { ...state, selection: [to.id], anchor: to.id, current: to.id }
    }
    case 'scrolledTo':
      if (state.current === action.id) return state
      // Like Preview: scrolling moves a single selection along, but never discards a multi-selection.
      if (state.selection.length > 1) return { ...state, current: action.id }
      return { ...state, current: action.id, selection: [action.id], anchor: action.id }
    case 'title':
      return { ...state, title: action.title }
    case 'annotate': {
      const next = editPage(state, action.pageId, (list) => [...list, action.annotation])
      return action.select ? { ...next, markup: { pageId: action.pageId, id: action.annotation.id } } : next
    }
    case 'updateAnnotation':
      return editPage(state, action.pageId, (list) =>
        list.map((a) => (a.id === action.annotation.id ? action.annotation : a)),
      )
    case 'removeAnnotation': {
      const next = editPage(state, action.pageId, (list) => list.filter((a) => a.id !== action.id))
      return state.markup?.id === action.id ? { ...next, markup: null } : next
    }
    case 'selectAnnotation':
      return { ...state, markup: action.target }
    case 'field':
      return setField(state, action.sourceId, action.name, action.value)
    case 'ocr':
      return { ...state, ocr: { ...state.ocr, [action.sourceId]: { ...state.ocr[action.sourceId], [action.index]: action.page } } }
    case 'restore':
      return withSelection(
        { ...initialState, sources: action.sources, fields: action.fields ?? {}, ocr: action.ocr ?? {}, title: action.title, history: createHistory(action.pages) },
        action.pages.slice(0, 1).map((p) => p.id),
      )
  }
}

function setField(state: State, sourceId: string, name: string, value: FieldValue | null): State {
  const own = state.fields[sourceId] ?? {}
  if (value === null ? !(name in own) : name in own && sameValue(own[name], value)) return state
  const next = { ...own }
  if (value === null) delete next[name]
  else next[name] = value
  const fields = { ...state.fields, [sourceId]: next }
  if (Object.keys(next).length === 0) delete fields[sourceId]
  return { ...state, fields }
}

function edit(state: State, pages: Page[]): State {
  const history = commit(state.history, pages)
  const markup = state.markup && findAnnotation(pages, state.markup) ? state.markup : null
  return { ...state, history, markup }
}

function editPage(state: State, pageId: string, fn: (list: Annotation[]) => Annotation[]): State {
  return edit(
    state,
    pagesOf(state).map((p) => (p.id === pageId ? { ...p, annotations: fn(p.annotations ?? []) } : p)),
  )
}

export function findAnnotation(pages: Page[], target: { pageId: string; id: string }): Annotation | undefined {
  return pages.find((p) => p.id === target.pageId)?.annotations?.find((a) => a.id === target.id)
}

function withSelection(state: State, ids: string[]): State {
  return { ...state, selection: ids, anchor: ids[0] ?? null, current: ids[0] ?? null }
}

function rangeIds(pages: Page[], a: string, b: string): string[] {
  const i = pages.findIndex((p) => p.id === a)
  const j = pages.findIndex((p) => p.id === b)
  if (i < 0 || j < 0) return [b]
  return pages.slice(Math.min(i, j), Math.max(i, j) + 1).map((p) => p.id)
}

/** Ids of pages in `to` that are new or rotated compared to `from`. */
function diffIds(from: Page[], to: Page[]): string[] {
  const before = new Set(from)
  return to.filter((p) => !before.has(p)).map((p) => p.id)
}

const sourceSize = (state: State, p: Page) => state.sources[p.sourceId].pages[p.index]

/** A blank A4 sheet with `pages` laid onto it in that order. */
function newSheet(state: State, pages: Page[]): { sheet: Source; page: Page } {
  const { size, places } = layoutSheet(pages.map((p) => displayedSize(sourceSize(state, p), p)))
  const sheet: Source = { id: newId(), name: 'Leere Seite', kind: 'blank', mime: null, bytes: null, pages: [size] }
  const annotations = pages.map((p, i): Annotation => ({ id: newId(), type: 'page', page: p, ...places[i] }))
  return { sheet, page: { id: newId(), sourceId: sheet.id, index: 0, rotation: 0, annotations } }
}

const centre = (a: Rect): Point => [a.x + a.w / 2, a.y + a.h / 2]

/** Top to bottom; boxes whose centres share a row go left to right. */
function readingOrder<T extends Rect>(boxes: T[]): T[] {
  return [...boxes].sort((a, b) => (sameRow(a, centre(b)) ? centre(a)[0] - centre(b)[0] : centre(a)[1] - centre(b)[1]))
}

/** Whether `box` comes before the point in reading order. */
function before(box: Rect, [x, y]: Point): boolean {
  const [cx, cy] = centre(box)
  return sameRow(box, [x, y]) ? cx < x : cy < y
}

const sameRow = (box: Rect, [, y]: Point) => y > box.y && y < box.y + box.h

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

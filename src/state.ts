import { commit, createHistory, redo, undo, type History } from './model/history'
import { newId } from './model/ids'
import { duplicatePages, insertPages, movePages, removePages, rotatePages } from './model/pages'
import type { Annotation, Page, Source, Sources } from './model/types'

export interface State {
  history: History<Page[]>
  sources: Sources
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
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; id: string; mode: 'single' | 'toggle' | 'range' }
  | { type: 'selectAll' }
  | { type: 'step'; delta: number; extend: boolean }
  | { type: 'scrolledTo'; id: string }
  | { type: 'title'; title: string }
  | { type: 'restore'; title: string; pages: Page[]; sources: Sources }
  | { type: 'annotate'; pageId: string; annotation: Annotation; select?: boolean }
  | { type: 'updateAnnotation'; pageId: string; annotation: Annotation }
  | { type: 'removeAnnotation'; pageId: string; id: string }
  | { type: 'selectAnnotation'; target: { pageId: string; id: string } | null }

export const initialState: State = {
  history: createHistory<Page[]>([]),
  sources: {},
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
    case 'restore':
      return withSelection(
        { ...initialState, sources: action.sources, title: action.title, history: createHistory(action.pages) },
        action.pages.slice(0, 1).map((p) => p.id),
      )
  }
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

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

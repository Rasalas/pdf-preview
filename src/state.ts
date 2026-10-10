import { commit, createHistory, redo, undo, type History } from './model/history'
import { newId } from './model/ids'
import { duplicatePages, insertPages, movePages, removePages, rotatePages } from './model/pages'
import type { Page, Source, Sources } from './model/types'

export interface State {
  history: History<Page[]>
  sources: Sources
  selection: string[]
  anchor: string | null
  /** The page shown in the viewer. */
  current: string | null
  title: string
}

export type Action =
  | { type: 'import'; sources: Source[]; at: number }
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

export const initialState: State = {
  history: createHistory<Page[]>([]),
  sources: {},
  selection: [],
  anchor: null,
  current: null,
  title: '',
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
      return withSelection(edit(next, insertPages(pages, added, action.at)), added.map((p) => p.id))
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
      return withSelection({ ...state, history }, selection)
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
    case 'restore':
      return withSelection(
        { ...initialState, sources: action.sources, title: action.title, history: createHistory(action.pages) },
        action.pages.slice(0, 1).map((p) => p.id),
      )
  }
}

function edit(state: State, pages: Page[]): State {
  return { ...state, history: commit(state.history, pages) }
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

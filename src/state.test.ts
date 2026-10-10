import { describe, expect, it } from 'vitest'
import type { Source } from './model/types'
import { initialState, pagesOf, reducer, type Action, type State } from './state'

const source = (id: string, n: number): Source => ({
  id,
  name: `${id}.pdf`,
  kind: 'pdf',
  mime: 'application/pdf',
  bytes: new Uint8Array(),
  pages: Array.from({ length: n }, () => ({ width: 1, height: 1 })),
})
const run = (...actions: Action[]) => actions.reduce(reducer, initialState)
const labels = (s: State) => pagesOf(s).map((p) => `${p.sourceId}${p.index + 1}`).join(' ')

describe('reducer', () => {
  it('imports a second file between pages as one undo step', () => {
    let s = run({ type: 'import', sources: [source('a', 2)], before: null })
    s = reducer(s, { type: 'import', sources: [source('b', 2)], before: pagesOf(s)[1].id })
    expect(labels(s)).toBe('a1 b1 b2 a2')
    expect(s.selection).toHaveLength(2)
    expect(s.title).toBe('a')
    s = reducer(s, { type: 'undo' })
    expect(labels(s)).toBe('a1 a2')
  })

  it('selects restored pages after undoing a delete', () => {
    let s = run({ type: 'import', sources: [source('a', 3)], before: null })
    const [, p2] = pagesOf(s)
    s = reducer(s, { type: 'select', id: p2.id, mode: 'single' })
    s = reducer(reducer(s, { type: 'remove' }), { type: 'undo' })
    expect(s.selection).toEqual([p2.id])
  })

  it('selects a range and moves it with the keyboard', () => {
    let s = run({ type: 'import', sources: [source('a', 4)], before: null })
    const [, p2, p3] = pagesOf(s)
    s = reducer(s, { type: 'select', id: p2.id, mode: 'single' })
    s = reducer(s, { type: 'select', id: p3.id, mode: 'range' })
    s = reducer(s, { type: 'nudge', delta: 1 })
    expect(labels(s)).toBe('a1 a4 a2 a3')
    s = reducer(s, { type: 'nudge', delta: -1 })
    s = reducer(s, { type: 'nudge', delta: -1 })
    expect(labels(s)).toBe('a2 a3 a1 a4')
  })

  it('selects the following page after deleting', () => {
    let s = run({ type: 'import', sources: [source('a', 3)], before: null })
    const [p1, p2, p3] = pagesOf(s)
    s = reducer(s, { type: 'select', id: p2.id, mode: 'single' })
    s = reducer(s, { type: 'remove' })
    expect(s.selection).toEqual([p3.id])
    s = reducer(s, { type: 'remove' })
    expect(s.selection).toEqual([p1.id])
  })

  it('keeps a multi-selection while scrolling', () => {
    let s = run({ type: 'import', sources: [source('a', 3)], before: null })
    const [p1, , p3] = pagesOf(s)
    s = reducer(s, { type: 'select', id: p1.id, mode: 'single' })
    s = reducer(s, { type: 'scrolledTo', id: p3.id })
    expect(s.selection).toEqual([p3.id])
    s = reducer(s, { type: 'selectAll' })
    s = reducer(s, { type: 'scrolledTo', id: p1.id })
    expect(s.selection).toHaveLength(3)
  })
})

describe('import anchoring', () => {
  it('inserts before an anchor page even after other imports shifted indices', () => {
    let s = run({ type: 'import', sources: [source('a', 2)], before: null })
    const anchor = pagesOf(s)[1].id
    // Another import lands at the front first, as a queued import would.
    s = reducer(s, { type: 'import', sources: [source('x', 1)], before: pagesOf(s)[0].id })
    s = reducer(s, { type: 'import', sources: [source('b', 1)], before: anchor })
    expect(labels(s)).toBe('x1 a1 b1 a2')
  })

  it('appends when the anchor page was deleted meanwhile', () => {
    let s = run({ type: 'import', sources: [source('a', 2)], before: null })
    const anchor = pagesOf(s)[0].id
    s = reducer(reducer(s, { type: 'select', id: anchor, mode: 'single' }), { type: 'remove' })
    s = reducer(s, { type: 'import', sources: [source('b', 1)], before: anchor })
    expect(labels(s)).toBe('a2 b1')
  })
})

describe('annotations', () => {
  it('adds, edits and removes annotations as undoable steps', () => {
    let s = run({ type: 'import', sources: [source('a', 1)], before: null })
    const [page] = pagesOf(s)
    const rect = { id: 'r', type: 'rect', color: '#f00', width: 2, x: 0, y: 0, w: 10, h: 10 } as const
    s = reducer(s, { type: 'annotate', pageId: page.id, annotation: rect, select: true })
    expect(s.markup).toEqual({ pageId: page.id, id: 'r' })
    s = reducer(s, { type: 'updateAnnotation', pageId: page.id, annotation: { ...rect, x: 5 } })
    expect(pagesOf(s)[0].annotations).toEqual([{ ...rect, x: 5 }])
    s = reducer(s, { type: 'undo' })
    expect(pagesOf(s)[0].annotations).toEqual([rect])
    s = reducer(s, { type: 'undo' })
    expect(pagesOf(s)[0].annotations ?? []).toEqual([])
    expect(s.markup).toBeNull()
  })

  it('keeps annotations on duplicated pages', () => {
    let s = run({ type: 'import', sources: [source('a', 1)], before: null })
    const [page] = pagesOf(s)
    s = reducer(s, { type: 'annotate', pageId: page.id, annotation: { id: 't', type: 'text', color: '#000', size: 12, x: 0, y: 0, text: 'x' } })
    s = reducer(reducer(s, { type: 'select', id: page.id, mode: 'single' }), { type: 'duplicate' })
    expect(pagesOf(s).map((p) => p.annotations?.length)).toEqual([1, 1])
  })
})

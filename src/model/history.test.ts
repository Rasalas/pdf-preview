import { describe, expect, it } from 'vitest'
import { commit, createHistory, redo, undo } from './history'

describe('history', () => {
  it('undoes and redoes', () => {
    let h = createHistory(1)
    h = commit(h, 2)
    h = commit(h, 3)
    h = undo(undo(h))
    expect(h.present).toBe(1)
    h = redo(h)
    expect(h.present).toBe(2)
  })
  it('drops the redo stack on a new commit', () => {
    const h = commit(undo(commit(createHistory(1), 2)), 5)
    expect(h.future).toEqual([])
    expect(undo(h).present).toBe(1)
  })
  it('ignores no-op commits', () => {
    const h = createHistory('x')
    expect(commit(h, 'x')).toBe(h)
  })
})

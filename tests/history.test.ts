import { describe, expect, it } from 'vitest'
import { commitHistory, createHistory, redoHistory, undoHistory } from '../src/shared/history'

describe('history', () => {
  it('undoes and redoes committed values', () => {
    let history = createHistory('a', 100)
    history = commitHistory(history, 'b')
    history = commitHistory(history, 'c')
    history = undoHistory(history)
    expect(history.present).toBe('b')
    history = redoHistory(history)
    expect(history.present).toBe('c')
  })
  it('limits the past stack and clears redo after a new commit', () => {
    let history = createHistory(0, 2)
    history = commitHistory(history, 1)
    history = commitHistory(history, 2)
    history = commitHistory(history, 3)
    expect(history.past).toEqual([1, 2])
    history = undoHistory(history)
    history = commitHistory(history, 9)
    expect(history.future).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { shortcutFromEvent } from '../src/renderer/hooks/useKeyboardShortcuts'

const key = (value: string, ctrlKey = false, shiftKey = false) => ({ key: value, ctrlKey, metaKey: false, shiftKey })

describe('keyboard shortcut mapping', () => {
  it('maps editing shortcuts centrally', () => {
    expect(shortcutFromEvent(key(' '))).toBe('play')
    expect(shortcutFromEvent(key('x'))).toBe('toggleCurrent')
    expect(shortcutFromEvent(key('Delete'))).toBe('delete')
    expect(shortcutFromEvent(key('a', true))).toBe('selectAll')
    expect(shortcutFromEvent(key('i', true))).toBe('invert')
    expect(shortcutFromEvent(key('z', true))).toBe('undo')
    expect(shortcutFromEvent(key('z', true, true))).toBe('redo')
    expect(shortcutFromEvent(key('s'))).toBe('split')
    expect(shortcutFromEvent(key('q'))).toBe('trimLeft')
    expect(shortcutFromEvent(key('w'))).toBe('trimRight')
  })
  it('maps navigation and zoom keys', () => {
    expect(shortcutFromEvent(key('ArrowLeft'))).toBe('stepBack')
    expect(shortcutFromEvent(key('ArrowRight'))).toBe('stepForward')
    expect(shortcutFromEvent(key('+'))).toBe('zoomIn')
    expect(shortcutFromEvent(key('-'))).toBe('zoomOut')
    expect(shortcutFromEvent(key('Home'))).toBe('home')
    expect(shortcutFromEvent(key('End'))).toBe('end')
  })
})

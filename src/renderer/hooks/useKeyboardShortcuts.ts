import { useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'

export type ShortcutAction = 'play' | 'toggleCurrent' | 'delete' | 'selectAll' | 'invert' | 'undo' | 'redo' | 'split' | 'trimLeft' | 'trimRight' | 'stepBack' | 'stepForward' | 'zoomIn' | 'zoomOut' | 'home' | 'end'

export function shortcutFromEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): ShortcutAction | null {
  const key = event.key.toLowerCase()
  const command = event.ctrlKey || event.metaKey
  if (command && key === 'a') return 'selectAll'
  if (command && key === 'i') return 'invert'
  if (command && key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === ' ') return 'play'
  if (key === 'x') return 'toggleCurrent'
  if (key === 'delete' || key === 'backspace') return 'delete'
  if (key === 's') return 'split'
  if (key === 'q') return 'trimLeft'
  if (key === 'w') return 'trimRight'
  if (key === 'arrowleft') return 'stepBack'
  if (key === 'arrowright') return 'stepForward'
  if (key === '+' || key === '=') return 'zoomIn'
  if (key === '-' || key === '_') return 'zoomOut'
  if (key === 'home') return 'home'
  if (key === 'end') return 'end'
  return null
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      const action = shortcutFromEvent(event)
      if (!action) return
      event.preventDefault()
      const state = useEditorStore.getState()
      const step = event.shiftKey ? 100 : 10
      const duration = state.media?.durationMs ?? 0
      const actions: Record<ShortcutAction, () => void> = {
        play: state.togglePlayback,
        toggleCurrent: state.toggleCurrentSegment,
        delete: () => state.setSelectedEnabled(true),
        selectAll: state.selectAll,
        invert: state.invertSelection,
        undo: state.undo,
        redo: state.redo,
        split: state.splitSelected,
        trimLeft: () => state.trimSelected('left'),
        trimRight: () => state.trimSelected('right'),
        stepBack: () => state.setPlayhead(state.playheadMs - step),
        stepForward: () => state.setPlayhead(state.playheadMs + step),
        zoomIn: () => state.setZoom(state.zoom * 1.25),
        zoomOut: () => state.setZoom(state.zoom / 1.25),
        home: () => state.setPlayhead(0),
        end: () => state.setPlayhead(duration)
      }
      actions[action]()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

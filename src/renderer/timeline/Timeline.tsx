import { useCallback, useEffect, useRef, useState } from 'react'
import { Minus, Plus, Redo2, Scissors, Undo2, ZoomIn } from 'lucide-react'
import { deletionToKeepRanges, enabledDeletions, formatTime, mergeRanges, snapTime } from '../../shared/ranges'
import { useEditorStore } from '../stores/editorStore'
import { WaveformCanvas } from './WaveformCanvas'

export function Timeline(): JSX.Element {
  const media = useEditorStore((state) => state.media)
  const ranges = useEditorStore((state) => state.rangeHistory.present)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const zoom = useEditorStore((state) => state.zoom)
  const waveform = useEditorStore((state) => state.waveform)
  const isWaveformLoading = useEditorStore((state) => state.isWaveformLoading)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLDivElement>(null)
  const [dragLabel, setDragLabel] = useState<{ x: number; time: number } | null>(null)
  const [viewportWindow, setViewportWindow] = useState({ left: 0, width: 1 })
  const duration = media?.durationMs ?? 1
  const keepRanges = deletionToKeepRanges(enabledDeletions(ranges), duration)
  const overviewCuts = mergeRanges(enabledDeletions(ranges), 0, duration)
  const ticks = Array.from({ length: 11 }, (_, index) => index / 10 * duration)

  const syncViewportWindow = useCallback((): void => {
    const viewport = viewportRef.current
    if (!viewport || viewport.scrollWidth <= 0) return
    setViewportWindow({
      left: viewport.scrollLeft / viewport.scrollWidth,
      width: Math.min(1, viewport.clientWidth / viewport.scrollWidth)
    })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    const observer = new ResizeObserver(syncViewportWindow)
    observer.observe(viewport)
    observer.observe(track)
    const frame = requestAnimationFrame(syncViewportWindow)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [zoom, media?.path, syncViewportWindow])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !media?.path) return
    const onWheel = (event: WheelEvent): void => {
      const state = useEditorStore.getState()
      if (event.altKey) {
        const delta = event.deltaY || event.deltaX
        if (!delta) return
        event.preventDefault()
        const rect = viewport.getBoundingClientRect()
        const cursorX = Math.min(rect.width, Math.max(0, event.clientX - rect.left))
        const timeRatio = (viewport.scrollLeft + cursorX) / Math.max(1, viewport.scrollWidth)
        const nextZoom = Math.min(12, Math.max(1, state.zoom * Math.exp(-delta * 0.0015)))
        state.setZoom(nextZoom)
        requestAnimationFrame(() => {
          viewport.scrollLeft = timeRatio * viewport.scrollWidth - cursorX
          syncViewportWindow()
        })
        return
      }

      if (viewport.scrollWidth <= viewport.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      event.preventDefault()
      viewport.scrollLeft += delta
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [media?.path, syncViewportWindow])

  const changeZoom = (next: number): void => {
    const viewport = viewportRef.current
    const state = useEditorStore.getState()
    if (!viewport) return state.setZoom(next)
    const oldWidth = viewport.scrollWidth
    const headX = state.playheadMs / duration * oldWidth
    const relative = headX - viewport.scrollLeft
    state.setZoom(next)
    requestAnimationFrame(() => {
      viewport.scrollLeft = state.playheadMs / duration * viewport.scrollWidth - relative
      syncViewportWindow()
    })
  }

  const timeAtClientX = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    const position = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(position * duration)
  }

  const startScrub = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const state = useEditorStore.getState()
    const resumePlayback = state.isPlaying
    state.setPlaying(false)
    state.setScrubbing(true)
    state.clearSelection()
    state.setPlayhead(timeAtClientX(event.clientX))
    setDragLabel({ x: event.clientX, time: timeAtClientX(event.clientX) })
    const onMove = (move: PointerEvent): void => {
      const time = timeAtClientX(move.clientX)
      useEditorStore.getState().setPlayhead(time)
      setDragLabel({ x: move.clientX, time })
    }
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const current = useEditorStore.getState()
      current.setPlayhead(timeAtClientX(up.clientX))
      current.setScrubbing(false)
      if (resumePlayback) current.setPlaying(true)
      setDragLabel(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startDrag = (event: React.PointerEvent, id: string, edge: 'left' | 'right'): void => {
    event.stopPropagation()
    const track = trackRef.current
    const initial = useEditorStore.getState().rangeHistory.present.find((range) => range.id === id)
    if (!track || !initial) return
    const startX = event.clientX
    const width = track.getBoundingClientRect().width
    useEditorStore.getState().beginRangeEdit()
    const onMove = (move: PointerEvent): void => {
      const state = useEditorStore.getState()
      const live = state.rangeHistory.present.find((range) => range.id === id)
      if (!live) return
      const raw = (edge === 'left' ? initial.startMs : initial.endMs) + (move.clientX - startX) / width * duration
      const targets = [state.playheadMs, 0, duration, ...state.rangeHistory.present.filter((range) => range.id !== id).flatMap((range) => [range.startMs, range.endMs])]
      const snapped = snapTime(raw, targets, 8 / width * duration, duration)
      const startMs = edge === 'left' ? Math.min(snapped, live.endMs - 10) : live.startMs
      const endMs = edge === 'right' ? Math.max(snapped, live.startMs + 10) : live.endMs
      state.previewRange(id, Math.max(0, startMs), Math.min(duration, endMs))
      setDragLabel({ x: move.clientX, time: edge === 'left' ? startMs : endMs })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      useEditorStore.getState().endRangeEdit()
      setDragLabel(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startOverviewSeek = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const overview = overviewRef.current
    const viewport = viewportRef.current
    if (!overview || !viewport) return
    const state = useEditorStore.getState()
    const resumePlayback = state.isPlaying
    state.setPlaying(false)
    state.setScrubbing(true)
    const update = (clientX: number): void => {
      const rect = overview.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)))
      useEditorStore.getState().setPlayhead(ratio * duration)
      viewport.scrollLeft = ratio * viewport.scrollWidth - viewport.clientWidth / 2
    }
    update(event.clientX)
    const onMove = (move: PointerEvent): void => update(move.clientX)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const current = useEditorStore.getState()
      current.setScrubbing(false)
      if (resumePlayback) current.setPlaying(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startOverviewPan = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const overview = overviewRef.current
    const viewport = viewportRef.current
    if (!overview || !viewport) return
    const startX = event.clientX
    const startScroll = viewport.scrollLeft
    const overviewWidth = Math.max(1, overview.getBoundingClientRect().width)
    const onMove = (move: PointerEvent): void => {
      viewport.scrollLeft = startScroll + (move.clientX - startX) / overviewWidth * viewport.scrollWidth
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return <section className={`timeline-shell ${media ? '' : 'timeline-disabled'}`}>
    <div className="timeline-toolbar">
      <div className="timeline-title"><b>粗剪时间轴</b><span>{ranges.length ? `${ranges.length} 个停顿区间 · 滚轮横移 · Alt+滚轮缩放` : '单轨 · 毫秒精度'}</span></div>
      <div className="edit-tools"><button className="icon-btn" title="撤销 Ctrl+Z" onClick={() => useEditorStore.getState().undo()}><Undo2 size={15} /></button><button className="icon-btn" title="重做 Ctrl+Shift+Z" onClick={() => useEditorStore.getState().redo()}><Redo2 size={15} /></button><span /><button className="tool-button" title="在播放头处分割 S" onClick={() => useEditorStore.getState().splitSelected()}><Scissors size={14} />分割</button></div>
      <div className="zoom-tools"><ZoomIn size={14} /><button className="icon-btn" onClick={() => changeZoom(zoom / 1.25)}><Minus size={14} /></button><input aria-label="时间轴缩放" type="range" min="1" max="12" step="0.25" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /><button className="icon-btn" onClick={() => changeZoom(zoom * 1.25)}><Plus size={14} /></button><span>{Math.round(zoom * 100)}%</span></div>
    </div>
    <div className="timeline-viewport" ref={viewportRef} onScroll={syncViewportWindow}>
      <div className="timeline-track" ref={trackRef} style={{ width: `${zoom * 100}%` }} onPointerDown={startScrub}>
        <div className="ruler">{ticks.map((tick) => <span key={tick} style={{ left: `${tick / duration * 100}%` }}><i />{formatTime(tick, false)}</span>)}</div>
        <div className="track-label">VOICE 01{isWaveformLoading ? ' · 计算波形…' : waveform ? ' · 真实峰值' : ''}</div>
        <WaveformCanvas waveform={waveform} loading={isWaveformLoading} />
        {keepRanges.map((range) => <div key={range.id} className="keep-overlay" style={{ left: `${range.startMs / duration * 100}%`, width: `${(range.endMs - range.startMs) / duration * 100}%` }} />)}
        {ranges.map((range) => <div key={range.id} className={`cut-segment ${range.enabled ? 'enabled' : 'restored'} ${selectedIds.includes(range.id) ? 'selected' : ''}`} style={{ left: `${range.startMs / duration * 100}%`, width: `${(range.endMs - range.startMs) / duration * 100}%` }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); useEditorStore.getState().selectRange(range.id, event.shiftKey ? 'extend' : (event.ctrlKey || event.metaKey) ? 'toggle' : 'single'); useEditorStore.getState().setPlayhead(range.startMs) }}>
          <button className="edge left" aria-label="调整开始时间" onPointerDown={(event) => startDrag(event, range.id, 'left')} onClick={(event) => event.stopPropagation()} /><span className="cut-stripes" /><button className="edge right" aria-label="调整结束时间" onPointerDown={(event) => startDrag(event, range.id, 'right')} onClick={(event) => event.stopPropagation()} />
        </div>)}
        <div className="playhead" style={{ left: `${playheadMs / duration * 100}%` }}><span /><i /></div>
      </div>
    </div>
    <div className="timeline-overview-shell">
      <div className="timeline-overview" ref={overviewRef} onPointerDown={startOverviewSeek} title="点击或拖动以快速跳转全片">
        <div className="overview-progress" style={{ width: `${playheadMs / duration * 100}%` }} />
        {overviewCuts.map((range) => <i key={range.id} className="overview-cut" style={{ left: `${range.startMs / duration * 100}%`, width: `${(range.endMs - range.startMs) / duration * 100}%` }} />)}
        {viewportWindow.width < 0.995 && <div className="overview-window" style={{ left: `${viewportWindow.left * 100}%`, width: `${viewportWindow.width * 100}%` }} onPointerDown={startOverviewPan} />}
        <div className="overview-playhead" style={{ left: `${playheadMs / duration * 100}%` }} />
      </div>
      <span>全片导航</span>
    </div>
    {dragLabel && <div className="drag-time" style={{ left: dragLabel.x }}>{formatTime(dragLabel.time)}</div>}
  </section>
}

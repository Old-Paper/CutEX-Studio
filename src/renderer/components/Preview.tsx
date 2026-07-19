import { useEffect, useMemo, useRef, useState } from 'react'
import { FileVideo2, Pause, Play, RotateCcw, RotateCw, Sparkles, Upload } from 'lucide-react'
import { formatTime } from '../../shared/ranges'
import { useEditorStore } from '../stores/editorStore'
import { findPlaybackSkipTarget, shouldAcceptMediaTime } from '../utils/playbackSync'

function AudioArtwork(): JSX.Element {
  const bars = useMemo(() => Array.from({ length: 72 }, (_, index) => 12 + ((index * 29 + index * index * 7) % 72)), [])
  return <div className="audio-art"><div className="audio-orb"><Sparkles size={42} /></div><div className="audio-bars">{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>
}

export function Preview(): JSX.Element {
  const media = useEditorStore((state) => state.media)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const isPlaying = useEditorStore((state) => state.isPlaying)
  const activeCutCount = useEditorStore((state) => state.rangeHistory.present.filter((range) => range.enabled).length)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)
  const importMedia = useEditorStore((state) => state.importMedia)
  const togglePlayback = useEditorStore((state) => state.togglePlayback)
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const [previewError, setPreviewError] = useState(false)

  useEffect(() => {
    const player = ref.current
    if (!player) return
    if (!isPlaying) return player.pause()
    const state = useEditorStore.getState()
    const durationMs = state.media?.durationMs ?? 0
    const skipTarget = findPlaybackSkipTarget(state.playheadMs, state.rangeHistory.present, durationMs)
    if (skipTarget !== null) {
      if (skipTarget >= durationMs) return setPlaying(false)
      pendingSeekRef.current = skipTarget
      player.currentTime = skipTarget / 1000
      state.setPlayhead(skipTarget)
    }
    void player.play().catch(() => setPlaying(false))
  }, [isPlaying, setPlaying])

  useEffect(() => {
    const player = ref.current
    if (!player || Math.abs(player.currentTime * 1000 - playheadMs) < 40) return
    pendingSeekRef.current = playheadMs
    try { player.currentTime = playheadMs / 1000 } catch { /* metadata will apply the pending seek */ }
  }, [playheadMs])

  useEffect(() => {
    if (!isPlaying || !media) return
    let frame = 0
    const checkDeletedRanges = (): void => {
      const player = ref.current
      const state = useEditorStore.getState()
      if (player && state.isPlaying && !state.isScrubbing) {
        const skipTarget = findPlaybackSkipTarget(player.currentTime * 1000, state.rangeHistory.present, media.durationMs)
        if (skipTarget !== null && pendingSeekRef.current !== skipTarget) {
          if (skipTarget >= media.durationMs) {
            player.pause()
            state.setPlayhead(media.durationMs)
            state.setPlaying(false)
            return
          }
          pendingSeekRef.current = skipTarget
          player.currentTime = skipTarget / 1000
          state.setPlayhead(skipTarget)
        }
      }
      frame = requestAnimationFrame(checkDeletedRanges)
    }
    frame = requestAnimationFrame(checkDeletedRanges)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, media])

  if (!media) return <main className="preview empty-preview">
    <div className="import-hero"><div className="import-icon"><Upload size={28} /></div><h1>把停顿，变成节奏</h1><p>选择或拖入配音素材，导入后立即自动识别空白并生成可调整的粗剪方案。</p><button className="btn primary hero-button" onClick={() => void importMedia()}><FileVideo2 size={17} />选择本地媒体</button><div className="format-list">MP4 · MOV · MKV · WEBM · MP3 · WAV · M4A</div></div>
  </main>

  const common = {
    ref,
    src: window.desktop.toMediaUrl(media.path),
    onLoadedMetadata: () => {
      const player = ref.current
      if (!player) return
      pendingSeekRef.current = useEditorStore.getState().playheadMs
      player.currentTime = pendingSeekRef.current / 1000
    },
    onTimeUpdate: () => {
      const currentMs = (ref.current?.currentTime ?? 0) * 1000
      const state = useEditorStore.getState()
      if (!shouldAcceptMediaTime(currentMs, pendingSeekRef.current, state.isScrubbing)) return
      pendingSeekRef.current = null
      state.setPlayhead(currentMs)
    },
    onSeeked: () => {
      const currentMs = (ref.current?.currentTime ?? 0) * 1000
      const state = useEditorStore.getState()
      if (!shouldAcceptMediaTime(currentMs, pendingSeekRef.current, state.isScrubbing, 250)) return
      pendingSeekRef.current = null
      state.setPlayhead(currentMs)
    },
    onEnded: () => setPlaying(false),
    onError: () => setPreviewError(true)
  }
  return <main className="preview">
    <div className="stage">
      {media.hasVideo && !previewError ? <video className="video-player" {...common} /> : media.hasAudio && !previewError ? <><AudioArtwork /><audio {...common} /></> : <div className="preview-error"><FileVideo2 size={34} /><b>此编码暂不支持直接预览</b><span>仍可正常分析与导出，建议使用 H.264 / AAC 预览源。</span></div>}
      <div className="stage-badge">{activeCutCount ? `粗剪预览 · 自动跳过 ${activeCutCount} 处` : '原始媒体预览'}</div>
    </div>
    <div className="transport">
      <div className="timecode"><b>{formatTime(playheadMs)}</b><span>/ {formatTime(media.durationMs)}</span></div>
      <div className="transport-buttons"><button className="icon-btn" title="后退 100 毫秒" onClick={() => setPlayhead(playheadMs - 100)}><RotateCcw size={17} /></button><button className="play-button" onClick={togglePlayback}>{isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button><button className="icon-btn" title="前进 100 毫秒" onClick={() => setPlayhead(playheadMs + 100)}><RotateCw size={17} /></button></div>
      <div className="shortcut-hint review-hint"><span><kbd>Space</kbd> 播放</span><span><kbd>X</kbd> 反选当前片段</span></div>
    </div>
  </main>
}

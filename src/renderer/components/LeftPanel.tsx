import { Feather, Film, Gauge, Music2, RotateCcw, SlidersHorizontal, Zap } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import type { DetectionParameters } from '../../shared/types'

const fields: { key: keyof DetectionParameters; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: 'thresholdDb', label: '静音阈值', unit: 'dB', min: -80, max: -5, step: 1 },
  { key: 'minimumSilenceMs', label: '最短静音', unit: 'ms', min: 1000, max: 3000, step: 10 },
  { key: 'keepBeforeMs', label: '前保留', unit: 'ms', min: 0, max: 1000, step: 10 },
  { key: 'keepAfterMs', label: '后保留', unit: 'ms', min: 0, max: 1000, step: 10 },
  { key: 'minimumKeepMs', label: '最短保留片段', unit: 'ms', min: 0, max: 2000, step: 10 },
  { key: 'mergeGapMs', label: '合并相邻间隔', unit: 'ms', min: 0, max: 1000, step: 10 }
]

const size = (bytes: number): string => bytes > 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(2)} GB` : `${(bytes / 1_048_576).toFixed(1)} MB`

export function LeftPanel(): JSX.Element {
  const media = useEditorStore((state) => state.media)
  const parameters = useEditorStore((state) => state.parameters)
  const selectedAudioStream = useEditorStore((state) => state.selectedAudioStream)
  const activePreset = useEditorStore((state) => state.activePreset)
  const setParameter = useEditorStore((state) => state.setParameter)
  const setAudioStream = useEditorStore((state) => state.setAudioStream)
  const applyPreset = useEditorStore((state) => state.applyPreset)
  return (
    <aside className="panel left-panel">
      <section className="panel-section media-card">
        <div className="section-title"><Film size={15} />媒体</div>
        {media ? <>
          <div className="media-name" title={media.path}>{media.name}</div>
          <div className="meta-grid">
            <span>类型</span><b>{media.hasVideo ? '视频' : '音频'}</b>
            <span>大小</span><b>{size(media.sizeBytes)}</b>
            {media.hasVideo && <><span>画面</span><b>{media.width} × {media.height}</b><span>编码</span><b>{media.videoCodec?.toUpperCase()}</b></>}
            <span>音频</span><b>{media.audioCodec?.toUpperCase() ?? '无'}</b>
          </div>
          {media.audioTracks.length > 0 && <label className="field audio-track"><span><Music2 size={13} />分析音轨</span><select value={selectedAudioStream ?? ''} onChange={(event) => setAudioStream(Number(event.target.value))}>{media.audioTracks.map((track) => <option key={track.streamIndex} value={track.streamIndex}>音轨 {track.ordinal + 1} · {track.language} · {track.channels}ch</option>)}</select></label>}
        </> : <div className="mini-empty"><Film size={24} /><span>导入后显示媒体信息</span></div>}
      </section>
      <section className="panel-section parameters">
        <div className="section-title"><SlidersHorizontal size={15} />剪辑节奏<button className="icon-btn" title="恢复中等节奏" onClick={() => applyPreset('balanced')}><RotateCcw size={14} /></button></div>
        <div className="preset-grid">
          <button className={activePreset === 'fast' ? 'active' : ''} onClick={() => applyPreset('fast')}><Zap size={14} /><b>快</b><span>阈值下全去除</span></button>
          <button className={activePreset === 'balanced' ? 'active' : ''} onClick={() => applyPreset('balanced')}><Gauge size={14} /><b>中</b><span>前后保留 4 帧</span></button>
          <button className={activePreset === 'gentle' ? 'active' : ''} onClick={() => applyPreset('gentle')}><Feather size={14} /><b>慢</b><span>前后保留 8 帧</span></button>
        </div>
        <div className="parameter-subtitle">详细参数{activePreset === 'custom' && <em>已自定义</em>}{media?.frameRate && <small>素材 {media.frameRate} fps</small>}</div>
        {fields.map((field) => <label className="parameter" key={field.key}>
          <span>{field.label}<small>{parameters[field.key]} {field.unit}</small></span>
          <input type="range" min={field.min} max={field.max} step={field.step} value={parameters[field.key]} onChange={(event) => setParameter(field.key, Number(event.target.value))} />
        </label>)}
        <div className="parameter-subtitle"><small>1 秒及以下的静音不会标记或删除</small></div>
      </section>
      <div className="privacy-note"><span className="privacy-dot" />全部处理均在本机完成，不上传媒体</div>
    </aside>
  )
}

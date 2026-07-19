import { useEffect, useState } from 'react'
import { Cpu, FileAudio2, FileVideo2, LoaderCircle, X, Zap } from 'lucide-react'
import { EXPORT_FORMATS } from '../../shared/exportFormats'
import type { ExportAcceleration, ExportFormat, ExportMode, HardwareEncoderInfo } from '../../shared/types'
import { useEditorStore } from '../stores/editorStore'

export function ExportDialog(): JSX.Element {
  const open = useEditorStore((state) => state.isExportDialogOpen)
  const media = useEditorStore((state) => state.media)
  const close = useEditorStore((state) => state.closeExportDialog)
  const exportMedia = useEditorStore((state) => state.exportMedia)
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('mp4')
  const [acceleration, setAcceleration] = useState<ExportAcceleration>('cpu')
  const [mode, setMode] = useState<ExportMode>('fast')
  const [encoders, setEncoders] = useState<HardwareEncoderInfo[]>([])
  const [detectingGpu, setDetectingGpu] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])
  useEffect(() => {
    if (!open || !media) return
    const availableFormats = EXPORT_FORMATS.filter((format) => format.kind === 'video' ? media.hasVideo : media.hasAudio)
    setSelectedFormat(availableFormats[0]?.id ?? 'mp3')
    setAcceleration('cpu')
    setMode('fast')
    if (!media.hasVideo) {
      setEncoders([])
      setDetectingGpu(false)
      return
    }
    let active = true
    setDetectingGpu(true)
    void window.desktop.getExportAccelerations()
      .then((result) => { if (active) setEncoders(result) })
      .catch(() => { if (active) setEncoders([]) })
      .finally(() => { if (active) setDetectingGpu(false) })
    return () => { active = false }
  }, [open, media])
  if (!open || !media) return <></>
  const formats = EXPORT_FORMATS.filter((format) => format.kind === 'video' ? media.hasVideo : media.hasAudio)
  const selectedInfo = formats.find((format) => format.id === selectedFormat) ?? formats[0]
  const supportsGpu = selectedInfo?.kind === 'video' && selectedInfo.id !== 'webm'
  const effectiveAcceleration = supportsGpu ? acceleration : 'cpu'
  return <div className="modal-backdrop" onMouseDown={close}>
    <div className="export-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <div className="export-dialog-head"><div><b>导出成片</b><span>先选择格式与编码方式，再开始导出</span></div><button className="icon-btn" onClick={close}><X size={16} /></button></div>
      {media.hasVideo && <div className="format-section"><label>视频格式</label><div className="format-grid">{formats.filter((format) => format.kind === 'video').map((format) => <button className={selectedFormat === format.id ? 'active' : ''} key={format.id} onClick={() => setSelectedFormat(format.id)}><i><FileVideo2 size={19} /></i><b>{format.label}</b><span>{format.description}</span></button>)}</div></div>}
      {media.hasAudio && <div className="format-section"><label>{media.hasVideo ? '仅导出音频' : '音频格式'}</label><div className="format-grid audio">{formats.filter((format) => format.kind === 'audio').map((format) => <button className={selectedFormat === format.id ? 'active' : ''} key={format.id} onClick={() => setSelectedFormat(format.id)}><i><FileAudio2 size={19} /></i><b>{format.label}</b><span>{format.description}</span></button>)}</div></div>}
      <div className="export-mode-section"><label>导出方式</label><div className="export-mode-grid">
        <button className={mode === 'fast' ? 'active' : ''} onClick={() => setMode('fast')}><Zap size={17} /><span><b>快速导出</b><small>推荐 · 单通道分段，适合大量切点</small></span></button>
        <button className={mode === 'precise' ? 'active' : ''} onClick={() => setMode('precise')}><Cpu size={17} /><span><b>高精度兼容</b><small>逐段毫秒裁切 · 切点很多时较慢</small></span></button>
      </div></div>
      {media.hasVideo && <div className="acceleration-section">
        <label>编码加速 {detectingGpu && <span><LoaderCircle className="spin" size={11} />正在真实检测 GPU…</span>}</label>
        {supportsGpu ? <div className="acceleration-grid">
          <button className={acceleration === 'cpu' ? 'active' : ''} onClick={() => setAcceleration('cpu')}><Cpu size={17} /><span><b>CPU 稳定模式</b><small>兼容性最好 · x264</small></span></button>
          {encoders.map((encoder) => <button key={encoder.id} disabled={!encoder.available} className={acceleration === encoder.id ? 'active' : ''} onClick={() => setAcceleration(encoder.id)}><Zap size={17} /><span><b>{encoder.label}</b><small>{encoder.available ? '已通过真实编码检测' : '当前设备不可用'}</small></span></button>)}
        </div> : <div className="acceleration-note"><Cpu size={15} /><span>{selectedInfo?.kind === 'audio' ? '音频导出不需要 GPU，将使用专用音频编码器。' : 'WebM 使用 VP9 多线程软件编码，H.264 GPU 加速不适用于此格式。'}</span></div>}
      </div>}
      <div className="export-dialog-foot"><span>{mode === 'fast' ? '快速模式按音视频帧边界裁切；失败会自动切换高精度模式。' : '高精度模式使用逐段毫秒裁切，适合最终母版。'}</span><button className="btn primary" disabled={!selectedInfo} onClick={() => selectedInfo && void exportMedia(selectedInfo.id, effectiveAcceleration, mode)}>开始导出</button></div>
    </div>
  </div>
}

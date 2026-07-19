import { ListFilter, RotateCcw, Scissors, Sparkles, Trash2 } from 'lucide-react'
import { formatTime } from '../../shared/ranges'
import { useEditorStore } from '../stores/editorStore'

export function RangeInspector(): JSX.Element {
  const ranges = useEditorStore((state) => state.rangeHistory.present)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const media = useEditorStore((state) => state.media)
  const selectRange = useEditorStore((state) => state.selectRange)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const toggleRangeEnabled = useEditorStore((state) => state.toggleRangeEnabled)
  const selectAll = useEditorStore((state) => state.selectAll)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const invertSelection = useEditorStore((state) => state.invertSelection)
  const setAllEnabled = useEditorStore((state) => state.setAllEnabled)
  const setSelectedEnabled = useEditorStore((state) => state.setSelectedEnabled)
  const cutMs = ranges.filter((range) => range.enabled).reduce((sum, range) => sum + range.endMs - range.startMs, 0)
  return <aside className="panel right-panel">
    <div className="inspector-head"><div><div className="section-title"><Scissors size={15} />建议删除</div><p>{ranges.length ? `${ranges.filter((range) => range.enabled).length} 个将在播放和导出时跳过` : '等待静音检测'}</p></div>{ranges.length > 0 && <span className="saved-time">-{formatTime(cutMs, false)}</span>}</div>
    {ranges.length > 0 && <div className="batch-actions"><button onClick={selectAll}>全选</button><button onClick={clearSelection}>取消</button><button onClick={invertSelection}>反选</button><button title="恢复所有区间" onClick={() => setAllEnabled(false)}><RotateCcw size={13} /></button></div>}
    {selectedIds.length > 0 && <div className="selection-actions"><button onClick={() => setSelectedEnabled(true)}>删除所选</button><button onClick={() => setSelectedEnabled(false)}>保留所选</button></div>}
    <div className="range-list">
      {!ranges.length && <div className="inspector-empty"><div className="empty-graphic"><Sparkles size={22} /></div><b>{media ? '未发现可粗剪片段' : '尚未导入媒体'}</b><span>{media ? '导入时已经自动扫描；可调整左侧预设后点击“重新粗剪”。' : '导入素材后会自动扫描，并在这里列出建议删除的空白。'}</span></div>}
      {ranges.map((range, index) => <button key={range.id} className={`range-row ${selectedIds.includes(range.id) ? 'selected' : ''} ${!range.enabled ? 'disabled-range' : ''}`} onClick={(event) => { selectRange(range.id, event.shiftKey ? 'extend' : (event.ctrlKey || event.metaKey) ? 'toggle' : 'single'); setPlayhead(range.startMs) }}>
        <span className="range-index">{String(index + 1).padStart(2, '0')}</span><span className="range-time"><b>{formatTime(range.startMs)}</b><small>{formatTime(range.endMs - range.startMs)} 长</small></span><span title={range.enabled ? '恢复这个片段' : '删除这个片段'} className={`range-state ${range.enabled ? 'on' : ''}`} onClick={(event) => { event.stopPropagation(); toggleRangeEnabled(range.id) }}>{range.enabled ? <><RotateCcw size={12} />恢复</> : <><Trash2 size={12} />删除</>}</span>
      </button>)}
    </div>
    {ranges.length > 0 && <div className="inspector-footer"><ListFilter size={14} /><span>X 反选当前片段 · Ctrl 多选 · Shift 连选</span></div>}
  </aside>
}

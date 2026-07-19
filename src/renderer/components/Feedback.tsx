import { AlertTriangle, CheckCircle2, LoaderCircle, X } from 'lucide-react'
import { formatTime } from '../../shared/ranges'
import { useEditorStore } from '../stores/editorStore'

export function Feedback(): JSX.Element {
  const task = useEditorStore((state) => state.task)
  const error = useEditorStore((state) => state.error)
  const notice = useEditorStore((state) => state.notice)
  if (task) return <div className="task-overlay"><div className="task-dialog"><div className="task-icon"><LoaderCircle className="spin" size={22} /></div><div className="task-copy"><b>{task.type === 'analysis' ? '正在分析配音停顿' : '正在导出成片'}</b><span>{task.message} · {formatTime(task.processedMs)}</span></div><strong>{task.percent}%</strong><div className="progress-track"><i style={{ width: `${task.percent}%` }} /></div><button className="btn ghost" onClick={() => void useEditorStore.getState().cancelTask()}>取消任务</button></div></div>
  if (error) return <div className="toast error"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => useEditorStore.getState().setError(null)}><X size={15} /></button></div>
  if (notice) return <div className="toast success"><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => useEditorStore.getState().setNotice(null)}><X size={15} /></button></div>
  return <></>
}

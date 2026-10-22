import { useEffect, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { Header } from './components/Header'
import { LeftPanel } from './components/LeftPanel'
import { Preview } from './components/Preview'
import { RangeInspector } from './components/RangeInspector'
import { Feedback } from './components/Feedback'
import { Timeline } from './timeline/Timeline'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { projectSignature, projectSnapshot, useEditorStore } from './stores/editorStore'
import { ExportDialog } from './components/ExportDialog'

export default function App(): JSX.Element {
  const [isDraggingFile, setDraggingFile] = useState(false)
  useKeyboardShortcuts()
  useEffect(() => window.desktop.onTaskProgress((progress) => useEditorStore.getState().applyProgress(progress)), [])
  useEffect(() => {
    void window.desktop.environmentStatus().then((status) => { if (!status.ready) useEditorStore.getState().setError(status.details) }).catch(() => useEditorStore.getState().setError('无法检查 FFmpeg 环境，请重启软件。'))
    void useEditorStore.getState().restoreRecovery()
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastSignature = ''
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.isReplacing || (!state.media && !previous.media)) return
      const signature = projectSignature(state) + state.savedSignature
      if (signature === lastSignature) return
      lastSignature = signature
      clearTimeout(timer)
      timer = setTimeout(() => {
        const current = useEditorStore.getState()
        void window.desktop.saveRecovery(current.isDirty ? projectSnapshot(current) : null)
          .catch(() => useEditorStore.getState().setError('恢复快照写入失败，请手动保存项目。'))
      }, 800)
    })
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      const state = useEditorStore.getState()
      if (state.isDirty || state.task) { event.preventDefault(); event.returnValue = false }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { unsubscribe(); clearTimeout(timer); window.removeEventListener('beforeunload', beforeUnload) }
  }, [])
  return <div
    className="app"
    onDragEnter={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDraggingFile(true) }}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false) }}
    onDrop={(event) => {
      event.preventDefault()
      setDraggingFile(false)
      const file = event.dataTransfer.files[0]
      if (file) void useEditorStore.getState().importDroppedMedia(file)
    }}
  >
    <Header /><div className="workspace"><LeftPanel /><Preview /><RangeInspector /><Timeline /></div><Feedback /><ExportDialog />
    {isDraggingFile && <div className="drop-overlay"><div><UploadCloud size={34} /><b>松开即可导入</b><span>视频和音频只在本机处理</span></div></div>}
  </div>
}

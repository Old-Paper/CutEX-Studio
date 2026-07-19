import { useEffect, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { Header } from './components/Header'
import { LeftPanel } from './components/LeftPanel'
import { Preview } from './components/Preview'
import { RangeInspector } from './components/RangeInspector'
import { Feedback } from './components/Feedback'
import { Timeline } from './timeline/Timeline'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useEditorStore } from './stores/editorStore'
import { ExportDialog } from './components/ExportDialog'

export default function App(): JSX.Element {
  const [isDraggingFile, setDraggingFile] = useState(false)
  useKeyboardShortcuts()
  useEffect(() => window.desktop.onTaskProgress((progress) => useEditorStore.getState().applyProgress(progress)), [])
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

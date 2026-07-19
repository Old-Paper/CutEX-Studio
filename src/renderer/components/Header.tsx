import { Download, FilePlus2, FolderOpen, Scissors, Save, SaveAll, Sparkles } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'

export function Header(): JSX.Element {
  const media = useEditorStore((state) => state.media)
  const task = useEditorStore((state) => state.task)
  const hasRoughCut = useEditorStore((state) => state.rawSilences.length > 0 || state.rangeHistory.present.length > 0)
  const { newProject, importMedia, openProject, saveProject, analyze, openExportDialog } = useEditorStore.getState()
  return (
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Scissors size={17} /></span><b>CutEX</b><span>Studio</span></div>
      <nav className="top-actions">
        <button className="btn ghost" onClick={newProject}><FilePlus2 size={16} />新建</button>
        <button className="btn ghost" onClick={() => void importMedia()}><FilePlus2 size={16} />导入媒体</button>
        <button className="btn ghost" onClick={() => void openProject()}><FolderOpen size={16} />打开项目</button>
        <button className="btn ghost" disabled={!media} onClick={() => void saveProject()}><Save size={16} />保存</button>
        <button className="icon-btn save-as" title="另存为" disabled={!media} onClick={() => void saveProject(true)}><SaveAll size={15} /></button>
        <span className="top-divider" />
        <button className="btn secondary" disabled={!media?.hasAudio || Boolean(task)} onClick={() => void analyze()}><Sparkles size={16} />{hasRoughCut ? '重新粗剪' : '智能粗剪'}</button>
        <button className="btn primary" disabled={!media || Boolean(task)} onClick={openExportDialog}><Download size={16} />导出成片</button>
      </nav>
    </header>
  )
}

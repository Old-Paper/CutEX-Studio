import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi, DetectionParameters, ExportOptions, MediaInfo, ProjectData, TaskProgress } from '../shared/types'

const api: DesktopApi = {
  selectMedia: () => ipcRenderer.invoke('media:select') as Promise<MediaInfo | null>,
  importDroppedFile: (file: unknown) => {
    const filePath = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])
    return ipcRenderer.invoke('media:probe-path', filePath)
  },
  generateWaveform: (input) => ipcRenderer.invoke('waveform:generate', input),
  analyzeSilence: (input: { taskId: string; media: MediaInfo; audioStreamIndex: number; parameters: DetectionParameters }) => ipcRenderer.invoke('analysis:start', input),
  saveProject: (project: ProjectData, saveAs = false) => ipcRenderer.invoke('project:save', project, saveAs),
  openProject: () => ipcRenderer.invoke('project:open'),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  getExportAccelerations: () => ipcRenderer.invoke('export:accelerations'),
  startExport: (options: ExportOptions) => ipcRenderer.invoke('export:start', options),
  cancelTask: (taskId: string) => ipcRenderer.invoke('task:cancel', taskId),
  revealFile: (path: string) => ipcRenderer.invoke('file:reveal', path),
  toMediaUrl: (path: string) => `local-media://media/${encodeURIComponent(path)}`,
  onTaskProgress: (callback: (progress: TaskProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TaskProgress): void => callback(progress)
    ipcRenderer.on('task:progress', listener)
    return () => ipcRenderer.removeListener('task:progress', listener)
  }
}

contextBridge.exposeInMainWorld('desktop', api)

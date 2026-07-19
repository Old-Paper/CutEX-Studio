import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { extname, join } from 'node:path'
import { stat } from 'node:fs/promises'
import type { ExportOptions, ProjectData } from '../../shared/types'
import { SUPPORTED_MEDIA_EXTENSIONS } from '../../shared/constants'
import { probeMedia } from '../ffprobe/probe'
import { detectSilence, type SilenceDetectionInput } from '../ffmpeg/silenceDetect'
import { cancelTask } from '../ffmpeg/taskManager'
import { exportMedia } from '../export/exportMedia'
import { getRecentProjects, openProject, saveProject } from '../project/projectService'
import { generateWaveform } from '../ffmpeg/waveform'
import { exportFormatInfo } from '../../shared/exportFormats'
import { detectHardwareEncoders } from '../ffmpeg/hardwareEncoders'

export function registerIpc(window: BrowserWindow): void {
  for (const channel of ['media:select', 'media:probe-path', 'waveform:generate', 'analysis:start', 'task:cancel', 'project:save', 'project:open', 'project:recent', 'export:accelerations', 'export:start', 'file:reveal']) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('media:select', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '选择本地视频或音频', properties: ['openFile'],
      filters: [{ name: '媒体文件', extensions: SUPPORTED_MEDIA_EXTENSIONS }, { name: '所有文件', extensions: ['*'] }]
    })
    return result.canceled || !result.filePaths[0] ? null : probeMedia(result.filePaths[0])
  })
  ipcMain.handle('media:probe-path', async (_event, filePath: string) => {
    if (!filePath) throw new Error('无法读取拖入文件的本地路径。')
    const extension = extname(filePath).slice(1).toLowerCase()
    if (!SUPPORTED_MEDIA_EXTENSIONS.includes(extension)) throw new Error(`不支持 .${extension || '未知'} 格式。`)
    const file = await stat(filePath)
    if (!file.isFile()) throw new Error('拖入的项目不是媒体文件。')
    return probeMedia(filePath)
  })
  ipcMain.handle('waveform:generate', (_event, input: { path: string; audioStreamIndex: number; durationMs: number; points: number }) => generateWaveform(input))
  ipcMain.handle('analysis:start', async (_event, input: SilenceDetectionInput) => ({
    taskId: input.taskId,
    rawSilences: await detectSilence(input, window)
  }))
  ipcMain.handle('task:cancel', (_event, taskId: string) => cancelTask(taskId))
  ipcMain.handle('project:save', (_event, project: ProjectData, saveAs: boolean) => saveProject(project, saveAs))
  ipcMain.handle('project:open', async () => {
    const result = await openProject()
    if (result?.mediaRelocated) result.project.media = await probeMedia(result.project.media.path)
    return result
  })
  ipcMain.handle('project:recent', () => getRecentProjects())
  ipcMain.handle('export:accelerations', () => detectHardwareEncoders())
  ipcMain.handle('export:start', async (_event, options: ExportOptions) => {
    const format = exportFormatInfo(options.format)
    const defaultName = `${options.inputPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'cutex'}-cut.${format.extension}`
    const selected = await dialog.showSaveDialog(window, {
      title: '导出剪辑结果', defaultPath: defaultName,
      filters: [{ name: `${format.label} ${format.kind === 'video' ? '视频' : '音频'}`, extensions: [format.extension] }]
    })
    if (selected.canceled || !selected.filePath) return null
    const outputPath = extname(selected.filePath).toLowerCase() === `.${format.extension}` ? selected.filePath : `${selected.filePath}.${format.extension}`
    const resolved = { ...options, outputPath }
    const logPath = join(app.getPath('logs'), `export-${Date.now()}.log`)
    return exportMedia(resolved, logPath, window)
  })
  ipcMain.handle('file:reveal', (_event, path: string) => shell.showItemInFolder(path))
}

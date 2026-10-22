import { app, dialog } from 'electron'
import { access, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectData, ProjectOpenResult } from '../../shared/types'
import { atomicWrite } from './atomicFile'
import { validateProject } from '../../shared/projectValidation'

const recentPath = (): string => join(app.getPath('userData'), 'recent-projects.json')

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function addRecent(path: string): Promise<void> {
  const current = await getRecentProjects()
  await atomicWrite(recentPath(), JSON.stringify([path, ...current.filter((item) => item !== path)].slice(0, 8), null, 2))
}

export async function getRecentProjects(): Promise<string[]> {
  try {
    const paths = JSON.parse(await readFile(recentPath(), 'utf8')) as string[]
    const checks = await Promise.all(paths.map(async (path) => ({ path, valid: await exists(path) })))
    return checks.filter((item) => item.valid).map((item) => item.path)
  } catch { return [] }
}

export async function saveProject(project: ProjectData, saveAs = false): Promise<string | null> {
  validateProject(project)
  let target = !saveAs ? project.projectPath : undefined
  if (!target) {
    const result = await dialog.showSaveDialog({
      title: '保存 CutEX 项目',
      defaultPath: `${project.media.name.replace(/\.[^.]+$/, '')}.cutex.json`,
      filters: [{ name: 'CutEX 项目（兼容旧版）', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    target = result.filePath.endsWith('.json') ? result.filePath : `${result.filePath}.cutex.json`
  }
  const payload: ProjectData = { ...project, projectPath: target, savedAt: new Date().toISOString(), version: 1 }
  if (target.toLowerCase() === project.media.path.toLowerCase()) throw new Error('项目不能覆盖原媒体文件。')
  await atomicWrite(target, JSON.stringify(payload, null, 2), true)
  await addRecent(target)
  return target
}

const recoveryPath = (): string => join(app.getPath('userData'), 'recovery.cutex.json')
let recoveryWrite: Promise<void> = Promise.resolve()
export function saveRecovery(project: ProjectData | null): Promise<void> {
  recoveryWrite = recoveryWrite.catch(() => undefined).then(async () => {
    if (project) await atomicWrite(recoveryPath(), JSON.stringify(project))
    else await rm(recoveryPath(), { force: true })
  })
  return recoveryWrite
}

export async function recoverProject(): Promise<ProjectOpenResult | null> {
  if (!(await exists(recoveryPath()))) return null
  const project = JSON.parse(await readFile(recoveryPath(), 'utf8')) as ProjectData
  validateProject(project)
  const answer = await dialog.showMessageBox({ type: 'question', title: '恢复未保存的剪辑',
    message: `发现 ${project.media.name} 的恢复快照。`, detail: '恢复不会覆盖正式工程。',
    buttons: ['恢复', '暂不恢复'], defaultId: 0, cancelId: 1 })
  if (answer.response !== 0) return null
  if (!(await exists(project.media.path))) throw new Error('恢复快照中的媒体已移动，请打开原项目并重新定位。')
  return { project, projectPath: project.projectPath ?? '', mediaRelocated: false }
}

export async function openProject(): Promise<ProjectOpenResult | null> {
  const result = await dialog.showOpenDialog({
    title: '打开 CutEX 项目', properties: ['openFile'],
    filters: [{ name: 'CutEX / DubCut 项目', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const projectPath = result.filePaths[0]
  const project = JSON.parse(await readFile(projectPath, 'utf8')) as ProjectData
  validateProject(project)
  let mediaRelocated = false
  if (!(await exists(project.media.path))) {
    const answer = await dialog.showMessageBox({
      type: 'warning', title: '找不到原媒体', message: '原媒体文件已移动或丢失。',
      detail: project.media.path, buttons: ['重新定位', '取消'], defaultId: 0, cancelId: 1
    })
    if (answer.response !== 0) return null
    const relocate = await dialog.showOpenDialog({ title: '重新定位媒体文件', properties: ['openFile'] })
    if (relocate.canceled || !relocate.filePaths[0]) return null
    project.media.path = relocate.filePaths[0]
    mediaRelocated = true
  }
  project.projectPath = projectPath
  await addRecent(projectPath)
  return { project, projectPath, mediaRelocated }
}

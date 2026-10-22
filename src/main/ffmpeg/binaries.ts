import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

function binary(name: string, override?: string): string {
  if (override) return override
  const bundled = process.resourcesPath ? join(process.resourcesPath, 'tools', `${name}.exe`) : ''
  return bundled && existsSync(bundled) ? bundled : name
}
export const ffmpegPath = binary('ffmpeg', process.env.FFMPEG_PATH)
export const ffprobePath = binary('ffprobe', process.env.FFPROBE_PATH)

let scriptOption: Promise<string> | undefined
export function complexFilterFileOption(): Promise<string> {
  return scriptOption ??= promisify(execFile)(ffmpegPath, ['-version'], { windowsHide: true, timeout: 10000 })
    .then(({ stdout }) => {
      const major = stdout.match(/ffmpeg version n?(\d+)\./)?.[1]
      return major && Number(major) < 7 ? '-filter_complex_script' : '-/filter_complex'
    }).catch((error: unknown) => { scriptOption = undefined; throw error })
}

export async function environmentStatus(): Promise<{ ready: boolean; details: string }> {
  const results = await Promise.all([ffmpegPath, ffprobePath].map(async (path) => {
    try { const result = await promisify(execFile)(path, ['-version'], { windowsHide: true, timeout: 10000 }); return result.stdout.split(/\r?\n/)[0] }
    catch { return null }
  }))
  return { ready: results.every(Boolean), details: results.every(Boolean) ? results.join('\n') : '未找到可用的 FFmpeg / FFprobe。请在终端运行 winget install --id Gyan.FFmpeg -e，安装后重启 CutEX Studio；也可设置 FFMPEG_PATH 和 FFPROBE_PATH。软件不会自动安装或修改系统。' }
}

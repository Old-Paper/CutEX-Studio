import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ExportAcceleration, ExportMode, ExportOptions, ExportResult, TaskProgress } from '../../shared/types'
import { buildConcatList, buildExportArgs, buildFastExportArgs, externalizeComplexFilter } from '../../shared/exportArgs'
import { ffmpegPath } from '../ffmpeg/binaries'
import { clearTaskCancellation, registerTask, wasTaskCancelled } from '../ffmpeg/taskManager'
import { appendLog } from '../logger'

class ExportCancelledError extends Error {}

function runFfmpegExport(
  options: ExportOptions,
  args: string[],
  logPath: string,
  window: BrowserWindow,
  acceleration: ExportAcceleration,
  mode: ExportMode,
  fallbackFrom?: Exclude<ExportAcceleration, 'cpu'>,
  modeFallback = false
): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    registerTask(options.taskId, child)
    child.stderr.setEncoding('utf8')
    let buffer = ''
    let recent = ''
    let settled = false
    child.stderr.on('data', (chunk: string) => {
      void appendLog(logPath, chunk)
      buffer += chunk
      recent = (recent + chunk).slice(-5000)
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const match = line.match(/^out_time_(?:us|ms)=(\d+)/)
        if (!match) continue
        const processedMs = Math.round(Number(match[1]) / 1000)
        const outputDuration = options.keepRanges.reduce((sum, range) => sum + range.endMs - range.startMs, 0)
        const progress: TaskProgress = {
          taskId: options.taskId,
          type: 'export',
          percent: Math.min(99, Math.round(processedMs / Math.max(1, outputDuration) * 100)),
          processedMs,
          message: mode === 'fast'
            ? (acceleration === 'cpu' ? '正在快速分段导出…' : 'GPU 正在快速分段导出…')
            : (acceleration === 'cpu' ? '正在高精度编码并拼接…' : 'GPU 正在高精度编码并拼接…')
        }
        window.webContents.send('task:progress', progress)
      }
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      if (signal || wasTaskCancelled(options.taskId)) return reject(new ExportCancelledError('导出已取消。'))
      if (code !== 0) return reject(new Error(`FFmpeg 导出失败：${recent.trim().slice(-1200)}`))
      window.webContents.send('task:progress', { taskId: options.taskId, type: 'export', percent: 100, processedMs: options.durationMs, message: '导出完成' } satisfies TaskProgress)
      resolve({ taskId: options.taskId, outputPath: options.outputPath!, logPath, acceleration, fallbackFrom, mode, modeFallback })
    })
  })
}

export async function exportMedia(options: ExportOptions, logPath: string, window: BrowserWindow): Promise<ExportResult> {
  clearTaskCancellation(options.taskId)
  const filterScriptPath = join(tmpdir(), `cutex-filter-${process.pid}-${randomUUID()}.txt`)
  const concatListPath = join(tmpdir(), `cutex-segments-${process.pid}-${randomUUID()}.ffconcat`)
  const requestedAcceleration = options.acceleration ?? 'cpu'
  const requestedMode = options.mode ?? 'precise'
  const supportsH264Hardware = options.hasVideo && (options.format === 'mp4' || options.format === 'mov' || options.format === 'mkv')
  const initialAcceleration: ExportAcceleration = supportsH264Hardware ? requestedAcceleration : 'cpu'
  let preciseScriptReady = false

  const argsFor = async (attemptOptions: ExportOptions, mode: ExportMode): Promise<string[]> => {
    if (mode === 'fast') return buildFastExportArgs(attemptOptions, concatListPath)
    const externalized = externalizeComplexFilter(buildExportArgs(attemptOptions), filterScriptPath)
    if (!preciseScriptReady) {
      await writeFile(filterScriptPath, externalized.filterGraph, 'utf8')
      preciseScriptReady = true
    }
    return externalized.args
  }

  try {
    if (requestedMode === 'fast') await writeFile(concatListPath, buildConcatList(options.inputPath, options.keepRanges), 'utf8')
    let fallbackFrom: Exclude<ExportAcceleration, 'cpu'> | undefined
    const initialOptions = { ...options, acceleration: initialAcceleration, mode: requestedMode }
    try {
      return await runFfmpegExport(initialOptions, await argsFor(initialOptions, requestedMode), logPath, window, initialAcceleration, requestedMode)
    } catch (error) {
      if (error instanceof ExportCancelledError) throw error
      if (initialAcceleration !== 'cpu') {
        fallbackFrom = initialAcceleration
        await appendLog(logPath, `\n[CutEX] ${fallbackFrom} GPU 初始化失败，自动回退 CPU。\n`)
        window.webContents.send('task:progress', {
          taskId: options.taskId, type: 'export', percent: 0, processedMs: 0,
          message: 'GPU 不可用，正在自动切换 CPU…'
        } satisfies TaskProgress)
        const cpuOptions = { ...options, acceleration: 'cpu' as const, mode: requestedMode }
        try {
          return await runFfmpegExport(cpuOptions, await argsFor(cpuOptions, requestedMode), logPath, window, 'cpu', requestedMode, fallbackFrom)
        } catch (cpuError) {
          if (cpuError instanceof ExportCancelledError || requestedMode === 'precise') throw cpuError
        }
      } else if (requestedMode === 'precise') throw error

      await appendLog(logPath, '\n[CutEX] 快速分段模式不兼容当前素材，自动回退高精度模式。\n')
      window.webContents.send('task:progress', {
        taskId: options.taskId, type: 'export', percent: 0, processedMs: 0,
        message: '快速模式不兼容，正在切换高精度模式…'
      } satisfies TaskProgress)
      const preciseOptions = { ...options, acceleration: 'cpu' as const, mode: 'precise' as const }
      return await runFfmpegExport(preciseOptions, await argsFor(preciseOptions, 'precise'), logPath, window, 'cpu', 'precise', fallbackFrom, true)
    }
  } finally {
    await rm(filterScriptPath, { force: true }).catch(() => undefined)
    await rm(concatListPath, { force: true }).catch(() => undefined)
    clearTaskCancellation(options.taskId)
  }
}

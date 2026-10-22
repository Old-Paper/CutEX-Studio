import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, copyFile, link, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ExportAcceleration, ExportMode, ExportOptions, ExportResult, TaskProgress } from '../../shared/types'
import { buildConcatList, buildExportArgs, buildFastExportArgs, externalizeComplexFilter } from '../../shared/exportArgs'
import { complexFilterFileOption, ffmpegPath } from '../ffmpeg/binaries'
import { clearTaskCancellation, registerTask, wasTaskCancelled } from '../ffmpeg/taskManager'
import { appendLog } from '../logger'
import { exportFailureKind } from '../../shared/exportFailure'
import { probeMedia } from '../ffprobe/probe'
import { exportFormatInfo } from '../../shared/exportFormats'

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
      void appendLog(logPath, chunk).catch(() => undefined)
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
      resolve({ taskId: options.taskId, outputPath: options.outputPath!, logPath, acceleration, fallbackFrom, mode, modeFallback })
    })
  })
}

export async function exportMedia(options: ExportOptions, logPath: string, window: BrowserWindow): Promise<ExportResult> {
  if (!options.outputPath) throw new Error('尚未选择输出路径。')
  const finalPath = resolve(options.outputPath)
  if (finalPath.toLowerCase() === resolve(options.inputPath).toLowerCase()) throw new Error('不能覆盖原媒体文件。')
  try { await access(finalPath); throw new Error('输出文件已存在，请选择新的文件名；已有成品不会被覆盖。') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporaryOutput = join(dirname(finalPath), `.cutex-${randomUUID()}${extname(finalPath)}`)
  options = { ...options, outputPath: temporaryOutput }
  const filterScriptPath = join(tmpdir(), `cutex-filter-${process.pid}-${randomUUID()}.txt`)
  const concatListPath = join(tmpdir(), `cutex-segments-${process.pid}-${randomUUID()}.ffconcat`)
  const requestedAcceleration = options.acceleration ?? 'cpu'
  const requestedMode = options.mode ?? 'precise'
  const supportsH264Hardware = options.hasVideo && (options.format === 'mp4' || options.format === 'mov' || options.format === 'mkv')
  const initialAcceleration: ExportAcceleration = supportsH264Hardware ? requestedAcceleration : 'cpu'
  let preciseScriptReady = false

  const argsFor = async (attemptOptions: ExportOptions, mode: ExportMode): Promise<string[]> => {
    if (wasTaskCancelled(options.taskId)) throw new ExportCancelledError('导出已取消。')
    if (mode === 'fast') return buildFastExportArgs(attemptOptions, concatListPath)
    const externalized = externalizeComplexFilter(buildExportArgs(attemptOptions), filterScriptPath, await complexFilterFileOption())
    if (!preciseScriptReady) {
      await writeFile(filterScriptPath, externalized.filterGraph, 'utf8')
      preciseScriptReady = true
    }
    return externalized.args
  }

  const attempt = async (acceleration: ExportAcceleration, mode: ExportMode, fallbackFrom?: Exclude<ExportAcceleration, 'cpu'>, modeFallback = false): Promise<ExportResult> => {
    const attemptOptions = { ...options, acceleration, mode }
    const result = await runFfmpegExport(attemptOptions, await argsFor(attemptOptions, mode), logPath, window, acceleration, mode, fallbackFrom, modeFallback)
    if (wasTaskCancelled(options.taskId)) throw new ExportCancelledError('导出已取消。')
    window.webContents.send('task:progress', { taskId: options.taskId, type: 'export', percent: 99, processedMs: 0, message: '正在校验时长、音视频流和可解码性…' } satisfies TaskProgress)
    const output = await probeMedia(temporaryOutput)
    const expected = options.keepRanges.reduce((sum, range) => sum + range.endMs - range.startMs, 0)
    const videoExpected = options.hasVideo && exportFormatInfo(options.format).kind === 'video'
    const [n, d] = (output.frameRate ?? '25/1').split('/').map(Number)
    const tolerance = Math.max(120, Number.isFinite(n / d) && n > 0 ? 2000 / (n / d) : 120)
    if (Math.abs(output.durationMs - expected) > tolerance || output.hasAudio !== options.hasAudio || output.hasVideo !== videoExpected) {
      throw new Error(`CUTEX_OUTPUT_INVALID：预期 ${expected} ms，实际 ${output.durationMs} ms，输出流或时长不匹配。`)
    }
    for (const position of [0, expected / 2, Math.max(0, expected - 200)]) {
      await verifyDecode(options.taskId, temporaryOutput, position)
    }
    if (wasTaskCancelled(options.taskId)) throw new ExportCancelledError('导出已取消。')
    // Hard-link publishes a complete file without overwriting another output.
    try { await link(temporaryOutput, finalPath) } catch (error) {
      if (!['ENOTSUP', 'EPERM', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      await copyFile(temporaryOutput, finalPath, constants.COPYFILE_EXCL)
    }
    window.webContents.send('task:progress', { taskId: options.taskId, type: 'export', percent: 100, processedMs: expected, message: '导出及校验完成' } satisfies TaskProgress)
    return { ...result, outputPath: finalPath }
  }

  try {
    if (requestedMode === 'fast') await writeFile(concatListPath, buildConcatList(options.inputPath, options.keepRanges), 'utf8')
    let fallbackFrom: Exclude<ExportAcceleration, 'cpu'> | undefined
    try {
      return await attempt(initialAcceleration, requestedMode)
    } catch (error) {
      if (error instanceof ExportCancelledError) throw error
      let failure = error
      if (initialAcceleration !== 'cpu' && exportFailureKind(error) === 'gpu') {
        fallbackFrom = initialAcceleration
        await appendLog(logPath, `\n[CutEX] ${fallbackFrom} GPU 初始化失败，自动回退 CPU。\n`)
        window.webContents.send('task:progress', {
          taskId: options.taskId, type: 'export', percent: 0, processedMs: 0,
          message: 'GPU 不可用，正在自动切换 CPU…'
        } satisfies TaskProgress)
        try {
          return await attempt('cpu', requestedMode, fallbackFrom)
        } catch (cpuError) {
          if (cpuError instanceof ExportCancelledError || requestedMode === 'precise') throw cpuError
          failure = cpuError
        }
      }
      if (requestedMode === 'precise' || exportFailureKind(failure) !== 'timing') throw failure

      await appendLog(logPath, '\n[CutEX] 快速分段模式不兼容当前素材，自动回退高精度模式。\n')
      window.webContents.send('task:progress', {
        taskId: options.taskId, type: 'export', percent: 0, processedMs: 0,
        message: '快速模式不兼容，正在切换高精度模式…'
      } satisfies TaskProgress)
      return await attempt('cpu', 'precise', fallbackFrom, true)
    }
  } finally {
    await rm(filterScriptPath, { force: true }).catch(() => undefined)
    await rm(concatListPath, { force: true }).catch(() => undefined)
    await rm(temporaryOutput, { force: true }).catch(() => undefined)
    clearTaskCancellation(options.taskId)
  }
}

function verifyDecode(taskId: string, path: string, positionMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-v', 'error', '-xerror', '-nostdin', '-ss', String(positionMs / 1000), '-i', path, '-t', '0.1', '-f', 'null', '-'], { windowsHide: true })
    registerTask(taskId, child)
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000) })
    child.once('error', reject)
    child.once('close', (code) => {
      if (wasTaskCancelled(taskId)) return reject(new ExportCancelledError('导出已取消。'))
      if (code !== 0) return reject(new Error(`输出无法解码：${stderr}`))
      resolve()
    })
  })
}

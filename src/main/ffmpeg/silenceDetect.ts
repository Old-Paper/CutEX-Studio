import { spawn } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import type { DetectionParameters, MediaInfo, TaskProgress, TimeRange } from '../../shared/types'
import { createRangeId } from '../../shared/ranges'
import { MINIMUM_AUTOMATIC_SILENCE_MS } from '../../shared/constants'
import { ffmpegPath } from './binaries'
import { registerTask } from './taskManager'

export interface SilenceDetectionInput {
  taskId: string
  media: MediaInfo
  audioStreamIndex: number
  parameters: DetectionParameters
}

export function buildSilenceDetectFilter(parameters: DetectionParameters): string {
  const minimumSilenceMs = Math.max(parameters.minimumSilenceMs, MINIMUM_AUTOMATIC_SILENCE_MS)
  return `silencedetect=noise=${parameters.thresholdDb}dB:d=${(minimumSilenceMs / 1000).toFixed(3)}`
}

export function detectSilence(input: SilenceDetectionInput, window: BrowserWindow): Promise<TimeRange[]> {
  const { taskId, media, audioStreamIndex, parameters } = input
  return new Promise((resolve, reject) => {
    const filter = buildSilenceDetectFilter(parameters)
    const args = ['-hide_banner', '-nostdin', '-i', media.path, '-map', `0:${audioStreamIndex}`, '-af', filter, '-f', 'null', '-']
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    registerTask(taskId, child)
    child.stderr.setEncoding('utf8')
    let buffer = ''
    let recent = ''
    const ranges: TimeRange[] = []
    let openStartMs: number | null = null
    let lastReported = -1
    const notify = (processedMs: number, message: string): void => {
      const percent = Math.min(99, Math.max(0, Math.round(processedMs / media.durationMs * 100)))
      if (percent !== lastReported) {
        lastReported = percent
        const progress: TaskProgress = { taskId, type: 'analysis', percent, processedMs, message }
        window.webContents.send('task:progress', progress)
      }
    }
    child.stderr.on('data', (chunk: string) => {
      buffer += chunk
      recent = (recent + chunk).slice(-4000)
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const start = line.match(/silence_start:\s*([\d.]+)/)
        const end = line.match(/silence_end:\s*([\d.]+)/)
        const time = line.match(/time=(\d+):(\d+):([\d.]+)/)
        if (start) openStartMs = Math.round(Number(start[1]) * 1000)
        if (end) {
          const endMs = Math.min(media.durationMs, Math.round(Number(end[1]) * 1000))
          ranges.push({ id: createRangeId('silence'), startMs: openStartMs ?? 0, endMs })
          openStartMs = null
        }
        if (time) notify(Math.round((Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])) * 1000), '正在扫描静音…')
      }
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (signal) return reject(new Error('静音检测已取消。'))
      if (code !== 0) return reject(new Error(`静音检测失败：${recent.trim().slice(-800)}`))
      if (openStartMs !== null) ranges.push({ id: createRangeId('silence'), startMs: openStartMs, endMs: media.durationMs })
      window.webContents.send('task:progress', { taskId, type: 'analysis', percent: 100, processedMs: media.durationMs, message: '分析完成' } satisfies TaskProgress)
      resolve(ranges)
    })
  })
}

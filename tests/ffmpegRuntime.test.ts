import { describe, expect, it } from 'vitest'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import { generateWaveform } from '../src/main/ffmpeg/waveform'
import { buildExportArgs } from '../src/shared/exportArgs'
import type { ExportFormat } from '../src/shared/types'
import { exportMedia } from '../src/main/export/exportMedia'
import { detectHardwareEncoders } from '../src/main/ffmpeg/hardwareEncoders'
import { probeMedia } from '../src/main/ffprobe/probe'

const mediaPath = process.env.CUTEX_QA_MEDIA ?? process.env.DUBCUT_QA_MEDIA
const outputDirectory = process.env.CUTEX_QA_OUTPUT ?? process.env.DUBCUT_QA_OUTPUT
const runtime = describe.runIf(Boolean(mediaPath && outputDirectory))

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-5_000) })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)))
  })
}

runtime('real FFmpeg processing', () => {
  it('extracts real peaks with a visible silent middle section', async () => {
    const waveform = await generateWaveform({ path: mediaPath!, audioStreamIndex: 1, durationMs: 3_000, points: 600 })
    const first = Math.max(...waveform.peaks.slice(0, 180))
    const middle = Math.max(...waveform.peaks.slice(220, 380))
    const last = Math.max(...waveform.peaks.slice(420))
    expect(first).toBeGreaterThan(.05)
    expect(middle).toBeLessThan(.01)
    expect(last).toBeGreaterThan(.05)
  }, 30_000)

  it('exports all supported video and audio formats', async () => {
    await mkdir(outputDirectory!, { recursive: true })
    const formats: ExportFormat[] = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a']
    for (const format of formats) {
      const outputPath = join(outputDirectory!, `粗剪 输出.${format}`)
      const args = buildExportArgs({
        taskId: `qa-${format}`, inputPath: mediaPath!, outputPath, format,
        durationMs: 3_000, keepRanges: [{ id: 'a', startMs: 0, endMs: 800 }, { id: 'b', startMs: 2_200, endMs: 3_000 }],
        hasVideo: true, hasAudio: true, audioStreamIndex: 1
      })
      await runFfmpeg(args)
      expect((await stat(outputPath)).size).toBeGreaterThan(1_000)
    }
  }, 180_000)

  it('exports hundreds of cuts without exceeding the Windows spawn limit', async () => {
    await mkdir(outputDirectory!, { recursive: true })
    const outputPath = join(outputDirectory!, '数百切点-长命令修复.mp3')
    const logPath = join(outputDirectory!, '数百切点-长命令修复.log')
    const keepRanges = Array.from({ length: 600 }, (_, index) => ({
      id: `keep-${index}`, startMs: index * 5, endMs: index * 5 + 3
    }))
    const options = {
      taskId: 'qa-many-cuts', inputPath: mediaPath!, outputPath, format: 'mp3' as const,
      durationMs: 3_000, keepRanges, hasVideo: true, hasAudio: true, audioStreamIndex: 1
    }
    expect(buildExportArgs(options).join(' ').length).toBeGreaterThan(32_767)

    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('cutex-filter-')))
    const window = { webContents: { send: () => undefined } } as unknown as BrowserWindow
    await exportMedia(options, logPath, window)
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('cutex-filter-') && !before.has(name))

    expect((await stat(outputPath)).size).toBeGreaterThan(1_000)
    expect(after).toEqual([])
  }, 180_000)

  it('uses an available GPU and automatically falls back for an unavailable GPU', async () => {
    await mkdir(outputDirectory!, { recursive: true })
    const encoders = await detectHardwareEncoders(true)
    const available = encoders.find((encoder) => encoder.available)
    const unavailable = encoders.find((encoder) => !encoder.available)
    const window = { webContents: { send: () => undefined } } as unknown as BrowserWindow
    const common = {
      taskId: 'qa-gpu', inputPath: mediaPath!, format: 'mp4' as const, durationMs: 3_000,
      keepRanges: [{ id: 'a', startMs: 0, endMs: 800 }, { id: 'b', startMs: 2_200, endMs: 3_000 }],
      hasVideo: true, hasAudio: true, audioStreamIndex: 1, mode: 'fast' as const
    }

    if (available) {
      const outputPath = join(outputDirectory!, `GPU-${available.id}.mp4`)
      const result = await exportMedia({ ...common, outputPath, acceleration: available.id }, join(outputDirectory!, `GPU-${available.id}.log`), window)
      expect(result.acceleration).toBe(available.id)
      expect(result.fallbackFrom).toBeUndefined()
      expect((await stat(outputPath)).size).toBeGreaterThan(1_000)
    }

    if (unavailable) {
      const outputPath = join(outputDirectory!, `GPU回退-${unavailable.id}.mp4`)
      const result = await exportMedia({ ...common, taskId: 'qa-gpu-fallback', outputPath, acceleration: unavailable.id }, join(outputDirectory!, `GPU回退-${unavailable.id}.log`), window)
      expect(result.acceleration).toBe('cpu')
      expect(result.fallbackFrom).toBe(unavailable.id)
      expect((await stat(outputPath)).size).toBeGreaterThan(1_000)
    }
  }, 180_000)

  it('fast segment mode keeps the expected duration without creating trim branches', async () => {
    await mkdir(outputDirectory!, { recursive: true })
    const outputPath = join(outputDirectory!, '快速分段模式.mp4')
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('cutex-segments-')))
    const window = { webContents: { send: () => undefined } } as unknown as BrowserWindow
    const result = await exportMedia({
      taskId: 'qa-fast-segments', inputPath: mediaPath!, outputPath, format: 'mp4', mode: 'fast', acceleration: 'cpu',
      durationMs: 3_000, keepRanges: [{ id: 'a', startMs: 0, endMs: 800 }, { id: 'b', startMs: 2_200, endMs: 3_000 }],
      hasVideo: true, hasAudio: true, audioStreamIndex: 1
    }, join(outputDirectory!, '快速分段模式.log'), window)
    const media = await probeMedia(outputPath)
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('cutex-segments-') && !before.has(name))
    expect(result.mode).toBe('fast')
    expect(result.modeFallback).toBe(false)
    expect(media.durationMs).toBeGreaterThanOrEqual(1_550)
    expect(media.durationMs).toBeLessThanOrEqual(1_650)
    expect(after).toEqual([])
  }, 180_000)
})

const longMediaPath = process.env.CUTEX_LONG_QA_MEDIA ?? process.env.DUBCUT_LONG_QA_MEDIA
describe.runIf(Boolean(longMediaPath && outputDirectory))('long media fast export benchmark', () => {
  it('handles 762 distributed cuts without constructing 1524 trim branches', async () => {
    await mkdir(outputDirectory!, { recursive: true })
    const media = await probeMedia(longMediaPath!)
    const segmentCount = 762
    const intervalMs = Math.floor(media.durationMs / segmentCount)
    const keepRanges = Array.from({ length: segmentCount }, (_, index) => ({
      id: `long-${index}`,
      startMs: index * intervalMs,
      endMs: Math.min(media.durationMs, index * intervalMs + 100)
    }))
    const encoders = await detectHardwareEncoders()
    const acceleration = encoders.find((encoder) => encoder.available)?.id ?? 'cpu'
    const outputPath = join(outputDirectory!, '长素材-762切点-快速模式.mp4')
    const window = { webContents: { send: () => undefined } } as unknown as BrowserWindow
    const startedAt = performance.now()
    const result = await exportMedia({
      taskId: 'qa-long-fast', inputPath: longMediaPath!, outputPath, format: 'mp4', mode: 'fast', acceleration,
      durationMs: media.durationMs, keepRanges, hasVideo: media.hasVideo, hasAudio: media.hasAudio,
      audioStreamIndex: media.audioTracks[0]?.streamIndex
    }, join(outputDirectory!, '长素材-762切点-快速模式.log'), window)
    const elapsedMs = performance.now() - startedAt
    expect(result.mode).toBe('fast')
    expect((await stat(outputPath)).size).toBeGreaterThan(1_000)
    expect(elapsedMs).toBeLessThan(180_000)
  }, 240_000)
})

import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { BrowserWindow } from 'electron'
import { exportMedia } from '../src/main/export/exportMedia'
import { probeMedia } from '../src/main/ffprobe/probe'
import { cancelTask } from '../src/main/ffmpeg/taskManager'
import { previewPath } from '../src/main/ffmpeg/preview'
import { generateWaveform } from '../src/main/ffmpeg/waveform'

function ffmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...args], { windowsHide: true })
    const chunks: Buffer[] = []; let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr)))
  })
}
const window = { webContents: { send: () => undefined } } as unknown as BrowserWindow

it('keeps flash/beep sync across irregular B-frame cuts in both export modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cutex-sync-'))
  const inputPath = join(directory, 'flash-tone.mp4')
  await ffmpeg(['-f', 'lavfi', '-i', "color=black:s=160x90:r=25:d=120,drawbox=color=white:t=fill:enable='lt(mod(t,1),0.08)'",
    '-f', 'lavfi', '-i', 'aevalsrc=if(lt(mod(t\\,1)\\,0.08)\\,0.5*sin(2*PI*1000*t)\\,0):s=48000:d=120',
    '-c:v', 'libx264', '-g', '50', '-bf', '3', '-c:a', 'aac', inputPath])
  for (const mode of ['precise', 'fast'] as const) {
    const outputPath = join(directory, `${mode}.mp4`)
    await exportMedia({ taskId: `sync-${mode}`, inputPath, outputPath, format: 'mp4', mode, hasVideo: true, hasAudio: true,
      audioStreamIndex: 1, durationMs: 120000,
      keepRanges: Array.from({ length: 40 }, (_, i) => ({ id: String(i), startMs: i * 3000 + [120, 480, 160, 200][i % 4], endMs: i * 3000 + 2320 })) }, join(directory, `${mode}.log`), window)
    const video = await ffmpeg(['-i', outputPath, '-an', '-vf', 'fps=25:start_time=0,scale=1:1,format=gray', '-f', 'rawvideo', 'pipe:1'])
    const audio = await ffmpeg(['-i', outputPath, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'])
    const flashes: number[] = [], beeps: number[] = []
    for (let i = 0; i < video.length; i++) if (video[i] > 128 && (i === 0 || video[i - 1] <= 128)) flashes.push(i * 40)
    let wasLoud = false
    for (let offset = 0; offset + 480 * 4 <= audio.length; offset += 480 * 4) {
      let energy = 0
      for (let j = 0; j < 480; j++) energy += audio.readFloatLE(offset + j * 4) ** 2
      const loud = Math.sqrt(energy / 480) > .1
      if (loud && !wasLoud) beeps.push(offset / (48000 * 4) * 1000)
      wasLoud = loud
    }
    expect(flashes.length).toBeGreaterThanOrEqual(70)
    expect(beeps.length, `${mode} pulse count`).toBe(flashes.length)
    for (let i = 0; i < flashes.length; i++) expect(Math.abs(flashes[i] - beeps[i]), `${mode} marker ${i}: video ${flashes.join(',')} audio ${beeps.join(',')}`).toBeLessThanOrEqual(40)
  }
}, 120000)

it('does not overwrite existing output and honours cancellation before spawning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutex-cancel-'))
  const inputPath = join(dir, 'source.wav')
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=duration=1', inputPath])
  const base = { taskId: 'cancel-before-start', inputPath, outputPath: inputPath, format: 'wav' as const, durationMs: 1000,
    hasAudio: true, hasVideo: false, keepRanges: [{ id: 'all', startMs: 0, endMs: 1000 }] }
  await expect(exportMedia(base, join(dir, 'log'), window)).rejects.toThrow('不能覆盖')
  cancelTask(base.taskId)
  await expect(exportMedia({ ...base, outputPath: join(dir, 'cancel.wav') }, join(dir, 'log'), window)).rejects.toThrow('取消')
  expect((await probeMedia(inputPath)).durationMs).toBe(1000)
})

it('prepares exactly the selected audio track for multi-track preview', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutex-tracks-'))
  const inputPath = join(dir, 'tracks.mp4')
  await ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=160x90:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', inputPath])
  const media = await probeMedia(inputPath)
  const selected = await previewPath(media, 2, join(dir, 'cache'))
  expect((await probeMedia(selected)).audioTracks).toHaveLength(1)
  const pcm = await ffmpeg(['-i', selected, '-vn', '-ac', '1', '-f', 'f32le', 'pipe:1'])
  let max = 0
  for (let i = 0; i < pcm.length; i += 4) max = Math.max(max, Math.abs(pcm.readFloatLE(i)))
  expect(max).toBeGreaterThan(.05)
  expect(await previewPath(media, 2, join(dir, 'cache'))).toBe(selected)
}, 30000)

it('handles VFR HEVC video without audio and opposite-phase stereo audio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutex-compat-'))
  const videoPath = join(dir, 'vfr-hevc.mp4')
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=25:d=4', '-vf', 'select=not(eq(mod(n\\,3)\\,0))',
    '-fps_mode', 'vfr', '-c:v', 'libx265', '-x265-params', 'pools=2:frame-threads=2:log-level=error', '-an', videoPath])
  const video = await probeMedia(videoPath)
  for (const mode of ['fast', 'precise'] as const) {
    const path = join(dir, `${mode}.mp4`)
    await exportMedia({ taskId: `compat-${mode}`, inputPath: videoPath, outputPath: path, format: 'mp4', mode,
      durationMs: video.durationMs, hasVideo: true, hasAudio: false,
      keepRanges: [{ id: 'a', startMs: 200, endMs: 1200 }, { id: 'b', startMs: 2200, endMs: 3200 }] }, join(dir, `${mode}.log`), window)
    const result = await probeMedia(path)
    expect(result.hasAudio).toBe(false)
    expect(Math.abs(result.durationMs - 2000)).toBeLessThanOrEqual(120)
  }
  const audioPath = join(dir, 'opposite.wav')
  await ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*440*t)|-0.5*sin(2*PI*440*t):s=48000:d=2', audioPath])
  const waveform = await generateWaveform({ path: audioPath, durationMs: 2000, audioStreamIndex: 0, points: 2000 }, join(dir, 'cache'))
  expect(Math.max(...waveform.peaks)).toBeGreaterThan(.45)
  expect(waveform.levels?.length).toBeGreaterThan(0)
  expect(await generateWaveform({ path: audioPath, durationMs: 2000, audioStreamIndex: 0, points: 2000 }, join(dir, 'cache'))).toEqual(waveform)
  const audioOut = join(dir, 'audio.mp3')
  await exportMedia({ taskId: 'compat-audio', inputPath: audioPath, outputPath: audioOut, format: 'mp3', mode: 'fast',
    durationMs: 2000, hasAudio: true, hasVideo: false, audioStreamIndex: 0,
    keepRanges: [{ id: 'a', startMs: 100, endMs: 1000 }] }, join(dir, 'audio.log'), window)
  expect((await probeMedia(audioOut)).hasVideo).toBe(false)
}, 30000)

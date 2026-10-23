import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { exportMedia } from '../src/main/export/exportMedia'
import { probeMedia } from '../src/main/ffprobe/probe'
import { detectHardwareEncoders } from '../src/main/ffmpeg/hardwareEncoders'

describe.runIf(process.env.CUTEX_BENCHMARK === '1')('controlled fifteen minute benchmark', () => {
  it('compares identical input, keep ranges and CPU quality, plus a separate GPU result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cutex-benchmark-'))
    const inputPath = join(directory, 'source.mp4')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=900',
        '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=900', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-bf', '2', '-c:a', 'aac', inputPath], { windowsHide: true })
      let stderr = ''; child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000) })
      child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)))
    })
    const keepRanges = Array.from({ length: 60 }, (_, i) => ({ id: String(i), startMs: i * 15000 + 120, endMs: i * 15000 + 2120 }))
    const expectedDuration = 120000
    const gpu = (await detectHardwareEncoders()).find((item) => item.available)
    const results: { mode: string; encoder: string; elapsedMs: number; durationMs: number }[] = []
    const cases = [{ mode: 'precise' as const, acceleration: 'cpu' as const }, { mode: 'fast' as const, acceleration: 'cpu' as const },
      ...(gpu ? [{ mode: 'fast' as const, acceleration: gpu.id }] : [])]
    for (const test of cases) {
      const outputPath = join(directory, `${test.mode}-${test.acceleration}.mp4`)
      const started = performance.now()
      const result = await exportMedia({ ...test, taskId: `benchmark-${test.mode}-${test.acceleration}`, inputPath, outputPath,
        durationMs: 900000, keepRanges, format: 'mp4', hasVideo: true, hasAudio: true, audioStreamIndex: 1 },
      join(directory, `${test.mode}-${test.acceleration}.log`), { webContents: { send: () => undefined } } as unknown as BrowserWindow)
      const elapsedMs = Math.round(performance.now() - started)
      const output = await probeMedia(outputPath)
      expect(Math.abs(output.durationMs - expectedDuration)).toBeLessThanOrEqual(120)
      results.push({ mode: result.mode, encoder: result.acceleration, elapsedMs, durationMs: output.durationMs })
    }
    const report = { sourceDurationMs: 900000, resolution: '320x180', fps: 25, cuts: 60, outputDurationMs: expectedDuration,
      note: 'Same input and edit list. CPU modes use identical x264 quality. GPU quality is not equivalent. Synthetic media is not a real-world speed guarantee.', results }
    await writeFile(join(directory, 'benchmark.json'), JSON.stringify(report, null, 2))
    console.info(`Benchmark report: ${join(directory, 'benchmark.json')}\n${JSON.stringify(report)}`)
  }, 300000)
})

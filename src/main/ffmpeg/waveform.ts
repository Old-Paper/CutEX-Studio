import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { WaveformData } from '../../shared/types'
import { ffmpegPath } from './binaries'
import { atomicWrite } from '../project/atomicFile'
import { registerTask } from './taskManager'

interface WaveformInput {
  path: string
  audioStreamIndex: number
  durationMs: number
  points: number
}

export class WaveformAccumulator {
  private readonly peaks: Float64Array
  private readonly squareSums: Float64Array
  private readonly counts: Uint32Array
  private sampleIndex = 0

  constructor(private readonly expectedSamples: number, private readonly points: number) {
    this.peaks = new Float64Array(points)
    this.squareSums = new Float64Array(points)
    this.counts = new Uint32Array(points)
  }

  addSample(amplitude: number): void {
    const value = Math.min(1, Math.max(0, amplitude))
    const bin = Math.min(this.points - 1, Math.floor(this.sampleIndex / this.expectedSamples * this.points))
    this.peaks[bin] = Math.max(this.peaks[bin], value)
    this.squareSums[bin] += value * value
    this.counts[bin] += 1
    this.sampleIndex += 1
  }

  result(): Pick<WaveformData, 'peaks' | 'rms'> {
    return {
      peaks: Array.from(this.peaks),
      rms: Array.from(this.squareSums, (sum, index) => this.counts[index] ? Math.sqrt(sum / this.counts[index]) : 0)
    }
  }
}

export function waveformLevels(peaks: number[], rms: number[]): NonNullable<WaveformData['levels']> {
  const levels: NonNullable<WaveformData['levels']> = []
  while (peaks.length > 512) {
    const nextPeaks: number[] = [], nextRms: number[] = []
    for (let i = 0; i < peaks.length; i += 2) {
      nextPeaks.push(Math.max(peaks[i], peaks[i + 1] ?? 0))
      nextRms.push(Math.sqrt((rms[i] ** 2 + (rms[i + 1] ?? rms[i]) ** 2) / 2))
    }
    levels.push({ peaks: nextPeaks, rms: nextRms })
    peaks = nextPeaks; rms = nextRms
  }
  return levels
}

const pending = new Map<string, Promise<WaveformData>>()
export async function generateWaveform(input: WaveformInput, cacheDirectory?: string): Promise<WaveformData> {
  const file = await stat(input.path)
  const key = createHash('sha256').update(JSON.stringify(['waveform-v3', input, file.size, file.mtimeMs])).digest('hex')
  const existing = pending.get(key)
  if (existing) return existing
  const operation = (async (): Promise<WaveformData> => {
    const cachePath = cacheDirectory ? join(cacheDirectory, `${key}.json`) : null
    if (cachePath) {
      try { const data = JSON.parse(await readFile(cachePath, 'utf8')) as WaveformData; if (data.peaks.length) return data } catch { /* cache miss */ }
    }
    const result = await extractWaveform(input)
    if (cachePath) {
      await mkdir(cacheDirectory!, { recursive: true })
      // Cache failure must not prevent editing the source media.
      await atomicWrite(cachePath, JSON.stringify(result)).catch(() => undefined)
    }
    return result
  })()
  pending.set(key, operation)
  try { return await operation } finally { pending.delete(key) }
}

function extractWaveform(input: WaveformInput): Promise<WaveformData> {
  const sampleRate = 48_000
  const points = Math.min(2_000_000, Math.max(256, Math.round(input.points)))
  const expectedSamples = Math.max(1, Math.round(input.durationMs / 1000 * sampleRate))
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-v', 'error', '-nostdin', '-i', input.path,
      '-map', `0:${input.audioStreamIndex}`, '-vn', '-ac', '2', '-ar', String(sampleRate),
      '-f', 's16le', 'pipe:1'
    ]
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    registerTask(`waveform-${randomUUID()}`, child)
    const accumulator = new WaveformAccumulator(expectedSamples, points)
    let remainder: Buffer | null = null
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const data = remainder ? Buffer.concat([remainder, chunk]) : chunk
      const usableLength = data.length - data.length % 4
      remainder = usableLength < data.length ? data.subarray(usableLength) : null
      for (let offset = 0; offset < usableLength; offset += 4) {
        // Peak envelope across channels: opposite-phase stereo must not cancel out.
        accumulator.addSample(Math.max(Math.abs(data.readInt16LE(offset)), Math.abs(data.readInt16LE(offset + 2))) / 32_768)
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4_000) })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`波形提取失败：${stderr.trim().slice(-800)}`))
      const result = accumulator.result()
      resolve({ ...result, sampleRate, levels: waveformLevels(result.peaks, result.rms) })
    })
  })
}

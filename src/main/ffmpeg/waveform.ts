import { spawn } from 'node:child_process'
import type { WaveformData } from '../../shared/types'
import { ffmpegPath } from './binaries'

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

export function generateWaveform(input: WaveformInput): Promise<WaveformData> {
  const sampleRate = 4_000
  const points = Math.min(4_000, Math.max(256, Math.round(input.points)))
  const expectedSamples = Math.max(1, Math.round(input.durationMs / 1000 * sampleRate))
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-v', 'error', '-nostdin', '-i', input.path,
      '-map', `0:${input.audioStreamIndex}`, '-vn', '-ac', '1', '-ar', String(sampleRate),
      '-f', 's16le', 'pipe:1'
    ]
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    const accumulator = new WaveformAccumulator(expectedSamples, points)
    let remainder: Buffer | null = null
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const data = remainder ? Buffer.concat([remainder, chunk]) : chunk
      const usableLength = data.length - data.length % 2
      remainder = usableLength < data.length ? data.subarray(usableLength) : null
      for (let offset = 0; offset < usableLength; offset += 2) {
        accumulator.addSample(Math.abs(data.readInt16LE(offset)) / 32_768)
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4_000) })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`波形提取失败：${stderr.trim().slice(-800)}`))
      resolve({ ...accumulator.result(), sampleRate })
    })
  })
}

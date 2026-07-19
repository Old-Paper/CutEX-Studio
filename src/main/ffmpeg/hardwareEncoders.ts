import { spawn } from 'node:child_process'
import type { HardwareEncoderInfo } from '../../shared/types'
import { ffmpegPath } from './binaries'

const candidates: Omit<HardwareEncoderInfo, 'available'>[] = [
  { id: 'nvidia', label: 'NVIDIA NVENC', encoder: 'h264_nvenc' },
  { id: 'intel', label: 'Intel Quick Sync', encoder: 'h264_qsv' },
  { id: 'amd', label: 'AMD AMF', encoder: 'h264_amf' }
]

let cachedDetection: Promise<HardwareEncoderInfo[]> | null = null

function probeEncoder(encoder: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30',
      '-frames:v', '1', '-an', '-c:v', encoder, '-f', 'null', '-'
    ], { windowsHide: true })
    let settled = false
    const finish = (available: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(available)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(false)
    }, 8_000)
    child.stdout.resume()
    child.stderr.resume()
    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0))
  })
}

export function detectHardwareEncoders(force = false): Promise<HardwareEncoderInfo[]> {
  if (!cachedDetection || force) {
    cachedDetection = Promise.all(candidates.map(async (candidate) => ({
      ...candidate,
      available: await probeEncoder(candidate.encoder)
    })))
  }
  return cachedDetection
}

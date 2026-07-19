import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AudioTrack, MediaInfo } from '../../shared/types'
import { ffprobePath } from '../ffmpeg/binaries'

interface ProbeStream {
  index: number
  codec_type: 'video' | 'audio' | string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  channels?: number
  channel_layout?: string
  sample_rate?: string
  tags?: { language?: string }
  duration?: string
}

interface ProbeResult {
  streams?: ProbeStream[]
  format?: { duration?: string; size?: string }
}

function runProbe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (data: string) => { stdout += data })
    child.stderr.setEncoding('utf8').on('data', (data: string) => { stderr += data })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`FFprobe 读取失败：${stderr.trim().slice(-800)}`)))
  })
}

export async function probeMedia(filePath: string): Promise<MediaInfo> {
  const output = await runProbe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath])
  let data: ProbeResult
  try { data = JSON.parse(output) as ProbeResult } catch { throw new Error('FFprobe 返回了无法解析的媒体信息。') }
  const streams = data.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio')
  const fileStat = await stat(filePath)
  const audioTracks: AudioTrack[] = audioStreams.map((stream, ordinal) => ({
    streamIndex: stream.index,
    ordinal,
    codec: stream.codec_name ?? 'unknown',
    language: stream.tags?.language ?? 'und',
    channels: stream.channels ?? 0,
    channelLayout: stream.channel_layout ?? 'unknown',
    sampleRate: Number.parseInt(stream.sample_rate ?? '0', 10) || 0
  }))
  const streamDuration = Math.max(0, ...streams.map((stream) => Number.parseFloat(stream.duration ?? '0') || 0))
  const durationSeconds = Number.parseFloat(data.format?.duration ?? '0') || streamDuration
  if (durationSeconds <= 0) throw new Error('无法读取媒体时长，文件可能损坏或格式不受支持。')
  return {
    path: filePath,
    name: basename(filePath),
    sizeBytes: Number(data.format?.size) || fileStat.size,
    durationMs: Math.round(durationSeconds * 1000),
    hasVideo: Boolean(video),
    hasAudio: audioTracks.length > 0,
    width: video?.width,
    height: video?.height,
    frameRate: video?.avg_frame_rate ?? video?.r_frame_rate,
    videoCodec: video?.codec_name,
    audioCodec: audioStreams[0]?.codec_name,
    audioTracks
  }
}

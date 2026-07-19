import type { ExportFormat } from './types'

export interface ExportFormatInfo {
  id: ExportFormat
  label: string
  extension: string
  kind: 'video' | 'audio'
  description: string
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'mp4', label: 'MP4', extension: 'mp4', kind: 'video', description: 'H.264 + AAC，兼容性最好' },
  { id: 'mov', label: 'MOV', extension: 'mov', kind: 'video', description: 'H.264 + AAC，适合后期软件' },
  { id: 'mkv', label: 'MKV', extension: 'mkv', kind: 'video', description: 'H.264 + AAC，开放容器' },
  { id: 'webm', label: 'WebM', extension: 'webm', kind: 'video', description: 'VP9 + Opus，适合网页' },
  { id: 'mp3', label: 'MP3', extension: 'mp3', kind: 'audio', description: '192 kbps，通用音频' },
  { id: 'wav', label: 'WAV', extension: 'wav', kind: 'audio', description: '无损 PCM，适合后期' },
  { id: 'm4a', label: 'M4A', extension: 'm4a', kind: 'audio', description: 'AAC 192 kbps，体积较小' }
]

export function exportFormatInfo(format: ExportFormat): ExportFormatInfo {
  const info = EXPORT_FORMATS.find((item) => item.id === format)
  if (!info) throw new Error(`不支持导出格式：${format}`)
  return info
}

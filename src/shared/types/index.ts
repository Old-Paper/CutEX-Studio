export interface TimeRange {
  id: string
  startMs: number
  endMs: number
}

export interface DeletionRange extends TimeRange {
  enabled: boolean
  source: 'detected' | 'manual'
}

export interface AudioTrack {
  streamIndex: number
  ordinal: number
  codec: string
  language: string
  channels: number
  channelLayout: string
  sampleRate: number
}

export interface MediaInfo {
  path: string
  name: string
  sizeBytes: number
  durationMs: number
  hasVideo: boolean
  hasAudio: boolean
  width?: number
  height?: number
  frameRate?: string
  videoCodec?: string
  audioCodec?: string
  audioTracks: AudioTrack[]
}

export interface DetectionParameters {
  thresholdDb: number
  minimumSilenceMs: number
  keepBeforeMs: number
  keepAfterMs: number
  minimumKeepMs: number
  mergeGapMs: number
}

export interface TaskProgress {
  taskId: string
  type: 'analysis' | 'export'
  percent: number
  processedMs: number
  message: string
}

export interface DetectionResult {
  taskId: string
  rawSilences: TimeRange[]
}

export type ExportFormat = 'mp4' | 'mov' | 'mkv' | 'webm' | 'mp3' | 'wav' | 'm4a'
export type ExportAcceleration = 'cpu' | 'nvidia' | 'intel' | 'amd'
export type ExportMode = 'fast' | 'precise'

export interface HardwareEncoderInfo {
  id: Exclude<ExportAcceleration, 'cpu'>
  label: string
  encoder: string
  available: boolean
}

export interface WaveformData {
  peaks: number[]
  rms: number[]
  sampleRate: number
}

export interface ExportOptions {
  taskId: string
  inputPath: string
  outputPath?: string
  keepRanges: TimeRange[]
  durationMs: number
  hasVideo: boolean
  hasAudio: boolean
  audioStreamIndex?: number
  format: ExportFormat
  acceleration?: ExportAcceleration
  mode?: ExportMode
}

export interface ProjectData {
  version: 1
  savedAt: string
  projectPath?: string
  media: MediaInfo
  selectedAudioStream: number | null
  detectionParameters: DetectionParameters
  rawSilences: TimeRange[]
  deletionRanges: DeletionRange[]
  keepRanges: TimeRange[]
  timelineZoom: number
  lastPlaybackMs: number
}

export interface ProjectOpenResult {
  project: ProjectData
  projectPath: string
  mediaRelocated: boolean
}

export interface ExportResult {
  taskId: string
  outputPath: string
  logPath: string
  acceleration: ExportAcceleration
  fallbackFrom?: Exclude<ExportAcceleration, 'cpu'>
  mode: ExportMode
  modeFallback?: boolean
}

export interface DesktopApi {
  selectMedia(): Promise<MediaInfo | null>
  importDroppedFile(file: unknown): Promise<MediaInfo>
  generateWaveform(input: { path: string; audioStreamIndex: number; durationMs: number; points: number }): Promise<WaveformData>
  analyzeSilence(input: {
    taskId: string
    media: MediaInfo
    audioStreamIndex: number
    parameters: DetectionParameters
  }): Promise<DetectionResult>
  saveProject(project: ProjectData, saveAs?: boolean): Promise<string | null>
  openProject(): Promise<ProjectOpenResult | null>
  getRecentProjects(): Promise<string[]>
  getExportAccelerations(): Promise<HardwareEncoderInfo[]>
  startExport(options: ExportOptions): Promise<ExportResult | null>
  cancelTask(taskId: string): Promise<boolean>
  revealFile(path: string): Promise<void>
  toMediaUrl(path: string): string
  onTaskProgress(callback: (progress: TaskProgress) => void): () => void
}

import type { DetectionParameters } from '../types'

export const DEFAULT_DETECTION_PARAMETERS: DetectionParameters = {
  thresholdDb: -35,
  minimumSilenceMs: 1000,
  keepBeforeMs: 80,
  keepAfterMs: 80,
  minimumKeepMs: 150,
  mergeGapMs: 100
}

export const SUPPORTED_MEDIA_EXTENSIONS = [
  'mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a'
]

export const PROJECT_EXTENSION = 'cutex.json'
export const HISTORY_LIMIT = 100
export const MINIMUM_AUTOMATIC_SILENCE_MS = 1000

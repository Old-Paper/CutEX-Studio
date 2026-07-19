import type { DetectionParameters } from './types'

export type RhythmPreset = 'fast' | 'balanced' | 'gentle'

export function parseFrameRate(value?: string): number {
  if (!value) return 30
  const [numeratorText, denominatorText] = value.split('/')
  const numerator = Number(numeratorText)
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText)
  const frameRate = numerator / denominator
  return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30
}

export function framesToMilliseconds(frames: number, frameRate?: string): number {
  return Math.round(Math.max(0, frames) * 1000 / parseFrameRate(frameRate))
}

export function detectionPreset(preset: RhythmPreset, frameRate?: string): DetectionParameters {
  if (preset === 'fast') return {
    thresholdDb: -35, minimumSilenceMs: 1000, keepBeforeMs: 0, keepAfterMs: 0, minimumKeepMs: 80, mergeGapMs: 60
  }
  const frames = preset === 'balanced' ? 4 : 8
  const paddingMs = framesToMilliseconds(frames, frameRate)
  return {
    thresholdDb: preset === 'balanced' ? -35 : -38,
    minimumSilenceMs: 1000,
    keepBeforeMs: paddingMs,
    keepAfterMs: paddingMs,
    minimumKeepMs: preset === 'balanced' ? 150 : 250,
    mergeGapMs: preset === 'balanced' ? 100 : 140
  }
}

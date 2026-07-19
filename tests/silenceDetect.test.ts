import { describe, expect, it } from 'vitest'
import { buildSilenceDetectFilter } from '../src/main/ffmpeg/silenceDetect'
import type { DetectionParameters } from '../src/shared/types'

const parameters = (minimumSilenceMs: number): DetectionParameters => ({
  thresholdDb: -35,
  minimumSilenceMs,
  keepBeforeMs: 0,
  keepAfterMs: 0,
  minimumKeepMs: 0,
  mergeGapMs: 0
})

describe('silence detection filter', () => {
  it('never asks FFmpeg to report silence shorter than one second', () => {
    expect(buildSilenceDetectFilter(parameters(50))).toBe('silencedetect=noise=-35dB:d=1.000')
    expect(buildSilenceDetectFilter(parameters(1000))).toBe('silencedetect=noise=-35dB:d=1.000')
  })

  it('keeps a stricter custom minimum', () => {
    expect(buildSilenceDetectFilter(parameters(1750))).toBe('silencedetect=noise=-35dB:d=1.750')
  })
})

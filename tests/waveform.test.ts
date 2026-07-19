import { describe, expect, it } from 'vitest'
import { WaveformAccumulator } from '../src/main/ffmpeg/waveform'

describe('waveform peak and RMS calculation', () => {
  it('keeps the true peak and calculates RMS per time bucket', () => {
    const waveform = new WaveformAccumulator(4, 2)
    waveform.addSample(.25)
    waveform.addSample(.75)
    waveform.addSample(.5)
    waveform.addSample(.5)
    const result = waveform.result()
    expect(result.peaks).toEqual([.75, .5])
    expect(result.rms[0]).toBeCloseTo(Math.sqrt((.25 ** 2 + .75 ** 2) / 2), 6)
    expect(result.rms[1]).toBeCloseTo(.5, 6)
  })

  it('clamps amplitudes and leaves empty buckets silent', () => {
    const waveform = new WaveformAccumulator(2, 3)
    waveform.addSample(2)
    waveform.addSample(-1)
    const result = waveform.result()
    expect(result.peaks[0]).toBe(1)
    expect(result.peaks[1]).toBe(0)
    expect(result.peaks[2]).toBe(0)
  })
})

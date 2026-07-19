import { describe, expect, it } from 'vitest'
import { detectionPreset, framesToMilliseconds, parseFrameRate } from '../src/shared/presets'

describe('rhythm presets', () => {
  it('parses integer and rational frame rates', () => {
    expect(parseFrameRate('30/1')).toBe(30)
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97, 2)
    expect(parseFrameRate('invalid')).toBe(30)
  })
  it('converts frame padding using the actual media frame rate', () => {
    expect(framesToMilliseconds(4, '25/1')).toBe(160)
    expect(framesToMilliseconds(8, '30/1')).toBe(267)
  })
  it('ignores one-second-or-shorter silence in every preset', () => {
    const preset = detectionPreset('fast', '30/1')
    expect(preset.keepBeforeMs).toBe(0)
    expect(preset.keepAfterMs).toBe(0)
    expect(preset.minimumSilenceMs).toBe(1000)
    expect(detectionPreset('balanced').minimumSilenceMs).toBe(1000)
    expect(detectionPreset('gentle').minimumSilenceMs).toBe(1000)
  })
  it('uses four and eight frames for balanced and gentle modes', () => {
    expect(detectionPreset('balanced', '25/1').keepBeforeMs).toBe(160)
    expect(detectionPreset('gentle', '25/1').keepAfterMs).toBe(320)
  })
})

import { describe, expect, it } from 'vitest'
import { findPlaybackSkipTarget, shouldAcceptMediaTime } from '../src/renderer/utils/playbackSync'

describe('playback synchronization', () => {
  it('ignores stale media callbacks while the user scrubs', () => {
    expect(shouldAcceptMediaTime(0, 5_000, true)).toBe(false)
  })

  it('ignores an old media time until the requested seek is reached', () => {
    expect(shouldAcceptMediaTime(0, 5_000, false)).toBe(false)
    expect(shouldAcceptMediaTime(4_920, 5_000, false)).toBe(true)
  })

  it('accepts normal playback updates when no seek is pending', () => {
    expect(shouldAcceptMediaTime(6_000, null, false)).toBe(true)
  })

  it('jumps across enabled deletion intervals and ignores restored ones', () => {
    const deletions = [
      { startMs: 1_000, endMs: 2_000, enabled: true },
      { startMs: 2_000, endMs: 2_500, enabled: true },
      { startMs: 4_000, endMs: 5_000, enabled: false }
    ]
    expect(findPlaybackSkipTarget(1_200, deletions, 10_000)).toBe(2_500)
    expect(findPlaybackSkipTarget(4_200, deletions, 10_000)).toBeNull()
  })

  it('stops at media end when the final interval is deleted', () => {
    expect(findPlaybackSkipTarget(9_200, [{ startMs: 9_000, endMs: 10_000, enabled: true }], 10_000)).toBe(10_000)
  })
})

import { describe, expect, it } from 'vitest'
import { clampRange, deletionToKeepRanges, dropShortDetectedDeletions, enabledDeletions, formatTime, gapSegmentAtTime, invertRangeSelection, mergeRanges, silenceToDeletionRanges, snapTime, splitRange } from '../src/shared/ranges'
import type { DetectionParameters, TimeRange } from '../src/shared/types'

const params: DetectionParameters = { thresholdDb: -35, minimumSilenceMs: 350, keepBeforeMs: 80, keepAfterMs: 80, minimumKeepMs: 150, mergeGapMs: 100 }
const range = (startMs: number, endMs: number, id = `${startMs}-${endMs}`): TimeRange => ({ id, startMs, endMs })

describe('silenceToDeletionRanges', () => {
  it('returns no cuts when there is no silence', () => expect(silenceToDeletionRanges([], 10_000, params)).toEqual([]))
  it('converts a single silence with leading and trailing preservation', () => {
    const [cut] = silenceToDeletionRanges([range(1000, 2500)], 10_000, params)
    expect([cut.startMs, cut.endMs]).toEqual([1080, 2420])
  })
  it('handles multiple silences', () => expect(silenceToDeletionRanges([range(1000, 2500), range(4000, 5500)], 10_000, params)).toHaveLength(2))
  it('ignores raw silence lasting less than or exactly one second', () => {
    const custom = { ...params, keepBeforeMs: 0, keepAfterMs: 0, minimumKeepMs: 0, mergeGapMs: 0 }
    const cuts = silenceToDeletionRanges([range(100, 1099), range(2000, 3000), range(4000, 5001)], 6000, custom)
    expect(cuts.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[4000, 5001]])
  })
  it('ignores an automatic cut that becomes one second after padding', () => {
    const custom = { ...params, keepBeforeMs: 100, keepAfterMs: 100, minimumKeepMs: 0, mergeGapMs: 0 }
    expect(silenceToDeletionRanges([range(1000, 2200)], 4000, custom)).toEqual([])
    expect(silenceToDeletionRanges([range(1000, 2201)], 4000, custom)[0]).toMatchObject({ startMs: 1100, endMs: 2101 })
  })
  it('does not preserve padding at the beginning of media', () => {
    const [cut] = silenceToDeletionRanges([range(0, 1500)], 10_000, params)
    expect([cut.startMs, cut.endMs]).toEqual([0, 1420])
  })
  it('does not preserve padding at the end of media', () => {
    const [cut] = silenceToDeletionRanges([range(8500, 10_000)], 10_000, params)
    expect([cut.startMs, cut.endMs]).toEqual([8580, 10_000])
  })
  it('handles a fully silent file', () => {
    const [cut] = silenceToDeletionRanges([range(0, 10_000)], 10_000, params)
    expect([cut.startMs, cut.endMs]).toEqual([0, 10_000])
  })
  it('merges overlapping raw silence ranges', () => {
    const [cut] = silenceToDeletionRanges([range(1000, 2500), range(2000, 3000)], 10_000, params)
    expect([cut.startMs, cut.endMs]).toEqual([1080, 2920])
  })
  it('merges adjacent deletion ranges within merge distance', () => {
    const custom = { ...params, keepBeforeMs: 0, keepAfterMs: 0, mergeGapMs: 150, minimumKeepMs: 0 }
    expect(silenceToDeletionRanges([range(100, 1300), range(1420, 2600)], 3000, custom)).toHaveLength(1)
  })
  it('drops reversed intervals caused by preservation padding', () => {
    expect(silenceToDeletionRanges([range(100, 1200)], 2000, { ...params, keepBeforeMs: 600, keepAfterMs: 600 })).toEqual([])
  })
  it('absorbs a keep fragment shorter than the configured minimum', () => {
    const custom = { ...params, keepBeforeMs: 0, keepAfterMs: 0, mergeGapMs: 0, minimumKeepMs: 200 }
    const [cut] = silenceToDeletionRanges([range(100, 1300), range(1450, 2600)], 3000, custom)
    expect([cut.startMs, cut.endMs]).toEqual([100, 2600])
  })
  it('removes short detected ranges from old projects but preserves manual edits', () => {
    const detected = (startMs: number, endMs: number) => ({ ...range(startMs, endMs), enabled: true, source: 'detected' as const })
    const manual = { ...range(3000, 3500), enabled: true, source: 'manual' as const }
    expect(dropShortDetectedDeletions([detected(0, 999), detected(1000, 2000), detected(3000, 4001), manual]))
      .toEqual([detected(3000, 4001), manual])
  })
})

describe('range utilities', () => {
  it('sorts and merges ranges while clipping to media bounds', () => {
    expect(mergeRanges([range(500, 1200), range(-100, 600)], 0, 1000).map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0, 1000]])
  })
  it('converts deletion ranges to keep ranges', () => {
    expect(deletionToKeepRanges([range(100, 200), range(400, 600)], 1000).map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0, 100], [200, 400], [600, 1000]])
  })
  it('returns the entire file when no deletions exist', () => expect(deletionToKeepRanges([], 1000)[0]).toMatchObject({ startMs: 0, endMs: 1000 }))
  it('returns no keep range when everything is deleted', () => expect(deletionToKeepRanges([range(0, 1000)], 1000)).toEqual([]))
  it('inverts selection', () => expect(invertRangeSelection(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']))
  it('finds the full keep segment under the playhead for one-key review', () => {
    const cuts = [range(100, 200), range(400, 600)]
    expect(gapSegmentAtTime(cuts, 300, 1000)).toMatchObject({ startMs: 200, endMs: 400 })
    expect(gapSegmentAtTime(cuts, 800, 1000)).toMatchObject({ startMs: 600, endMs: 1000 })
    expect(gapSegmentAtTime(cuts, 150, 1000)).toBeNull()
  })
  it('treats the media end as part of the last review segment', () => {
    expect(gapSegmentAtTime([range(100, 200)], 1000, 1000)).toMatchObject({ startMs: 200, endMs: 1000 })
    expect(gapSegmentAtTime([], 500, 1000)).toMatchObject({ startMs: 0, endMs: 1000 })
  })
  it('splits only inside a range', () => {
    const result = splitRange(range(100, 500), 300)
    expect(result?.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[100, 300], [300, 500]])
    expect(splitRange(range(100, 500), 100)).toBeNull()
  })
  it('repairs invalid numeric boundaries using integer milliseconds', () => expect(clampRange(range(-10.2, 1200.8), 1000)).toMatchObject({ startMs: 0, endMs: 1000 }))
  it('snaps to the closest target inside the threshold and clamps bounds', () => {
    expect(snapTime(494, [500, 510], 8, 1000)).toBe(500)
    expect(snapTime(-20, [500], 8, 1000)).toBe(0)
    expect(snapTime(480, [500], 8, 1000)).toBe(480)
  })
  it('formats millisecond timecodes with optional hours and precision', () => {
    expect(formatTime(62_005)).toBe('01:02.005')
    expect(formatTime(3_662_005, false)).toBe('01:01:02')
  })
  it('extracts only enabled deletion intervals', () => {
    const deletions = [{ ...range(0, 100, 'a'), enabled: true, source: 'detected' as const }, { ...range(200, 300, 'b'), enabled: false, source: 'manual' as const }]
    expect(enabledDeletions(deletions)).toEqual([{ id: 'a', startMs: 0, endMs: 100 }])
  })
})

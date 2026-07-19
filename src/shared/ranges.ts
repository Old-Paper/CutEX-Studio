import type { DeletionRange, DetectionParameters, TimeRange } from './types'
import { MINIMUM_AUTOMATIC_SILENCE_MS } from './constants'

let idCounter = 0
export const createRangeId = (prefix = 'range'): string => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

const integer = (value: number): number => Math.round(Number.isFinite(value) ? value : 0)

export function clampRange(range: TimeRange, durationMs: number): TimeRange {
  const duration = Math.max(0, integer(durationMs))
  const startMs = Math.min(duration, Math.max(0, integer(range.startMs)))
  const endMs = Math.min(duration, Math.max(startMs, integer(range.endMs)))
  return { ...range, startMs, endMs }
}

export function sortRanges<T extends TimeRange>(ranges: T[]): T[] {
  return [...ranges].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

export function mergeRanges<T extends TimeRange>(ranges: T[], gapMs = 0, durationMs = Number.MAX_SAFE_INTEGER): TimeRange[] {
  const sorted = sortRanges(ranges.map((range) => clampRange(range, durationMs))).filter((range) => range.endMs > range.startMs)
  const merged: TimeRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.startMs <= previous.endMs + Math.max(0, integer(gapMs))) {
      previous.endMs = Math.max(previous.endMs, range.endMs)
    } else {
      merged.push({ id: range.id || createRangeId(), startMs: range.startMs, endMs: range.endMs })
    }
  }
  return merged
}

export function deletionToKeepRanges(deletions: TimeRange[], durationMs: number): TimeRange[] {
  const duration = Math.max(0, integer(durationMs))
  const merged = mergeRanges(deletions, 0, duration)
  const keep: TimeRange[] = []
  let cursor = 0
  for (const deletion of merged) {
    if (deletion.startMs > cursor) keep.push({ id: createRangeId('keep'), startMs: cursor, endMs: deletion.startMs })
    cursor = Math.max(cursor, deletion.endMs)
  }
  if (cursor < duration) keep.push({ id: createRangeId('keep'), startMs: cursor, endMs: duration })
  return keep
}

export function silenceToDeletionRanges(
  silences: TimeRange[],
  durationMs: number,
  parameters: DetectionParameters
): DeletionRange[] {
  const duration = Math.max(0, integer(durationMs))
  const normalizedSilences = mergeRanges(silences, 0, duration)
    .filter((silence) => silence.endMs - silence.startMs > MINIMUM_AUTOMATIC_SILENCE_MS)
  const padded = normalizedSilences
    .map((silence) => ({
      id: silence.id,
      startMs: silence.startMs === 0 ? 0 : silence.startMs + Math.max(0, integer(parameters.keepAfterMs)),
      endMs: silence.endMs === duration ? duration : silence.endMs - Math.max(0, integer(parameters.keepBeforeMs))
    }))
    .filter((range) => range.endMs - range.startMs > MINIMUM_AUTOMATIC_SILENCE_MS)

  let merged = mergeRanges(padded, parameters.mergeGapMs, duration)
  if (parameters.minimumKeepMs > 0 && merged.length > 1) {
    const compacted: TimeRange[] = []
    for (const current of merged) {
      const previous = compacted.at(-1)
      if (previous && current.startMs - previous.endMs < parameters.minimumKeepMs) previous.endMs = current.endMs
      else compacted.push({ ...current })
    }
    merged = compacted
  }

  return merged.map((range) => ({ ...range, id: createRangeId('cut'), enabled: true, source: 'detected' }))
}

export function dropShortDetectedDeletions(ranges: DeletionRange[]): DeletionRange[] {
  return ranges.filter((range) => range.source !== 'detected' || range.endMs - range.startMs > MINIMUM_AUTOMATIC_SILENCE_MS)
}

export function invertRangeSelection(allIds: string[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds)
  return allIds.filter((id) => !selected.has(id))
}

export function gapSegmentAtTime(ranges: TimeRange[], atMs: number, durationMs: number): TimeRange | null {
  const duration = Math.max(0, integer(durationMs))
  if (duration === 0) return null

  const time = Math.min(duration - 1, Math.max(0, integer(atMs)))
  const sorted = sortRanges(ranges.map((range) => clampRange(range, duration)))
    .filter((range) => range.endMs > range.startMs)
  let startMs = 0
  let endMs = duration

  for (const range of sorted) {
    if (time >= range.startMs && time < range.endMs) return null
    if (range.endMs <= time) startMs = Math.max(startMs, range.endMs)
    else if (range.startMs > time) {
      endMs = Math.min(endMs, range.startMs)
      break
    }
  }

  return endMs > startMs ? { id: createRangeId('segment'), startMs, endMs } : null
}

export function splitRange<T extends TimeRange>(range: T, atMs: number): [T, T] | null {
  const at = integer(atMs)
  if (at <= range.startMs || at >= range.endMs) return null
  return [
    { ...range, id: createRangeId('split'), endMs: at },
    { ...range, id: createRangeId('split'), startMs: at }
  ]
}

export function snapTime(valueMs: number, targetsMs: number[], thresholdMs: number, durationMs: number): number {
  const clamped = Math.min(durationMs, Math.max(0, integer(valueMs)))
  let best = clamped
  let distance = Math.max(0, thresholdMs) + 1
  for (const target of targetsMs) {
    const currentDistance = Math.abs(target - clamped)
    if (currentDistance <= thresholdMs && currentDistance < distance) {
      best = integer(target)
      distance = currentDistance
    }
  }
  return best
}

export function formatTime(ms: number, precise = true): string {
  const value = Math.max(0, integer(ms))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor((value % 3_600_000) / 60_000)
  const seconds = Math.floor((value % 60_000) / 1_000)
  const millis = value % 1_000
  const base = `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return precise ? `${base}.${String(millis).padStart(3, '0')}` : base
}

export function enabledDeletions(ranges: DeletionRange[]): TimeRange[] {
  return ranges.filter((range) => range.enabled).map(({ id, startMs, endMs }) => ({ id, startMs, endMs }))
}

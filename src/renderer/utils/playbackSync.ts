export function shouldAcceptMediaTime(
  mediaTimeMs: number,
  pendingSeekMs: number | null,
  isScrubbing: boolean,
  toleranceMs = 150
): boolean {
  if (isScrubbing) return false
  if (pendingSeekMs === null) return true
  return Math.abs(mediaTimeMs - pendingSeekMs) <= toleranceMs
}

interface DeletionLike {
  startMs: number
  endMs: number
  enabled: boolean
}

export function findPlaybackSkipTarget(positionMs: number, deletions: DeletionLike[], durationMs: number): number | null {
  let target = Math.max(0, Math.min(durationMs, Math.round(positionMs)))
  let changed = false
  for (;;) {
    const deletion = deletions.find((range) => range.enabled && target >= range.startMs && target < range.endMs)
    if (!deletion) break
    target = Math.min(durationMs, deletion.endMs)
    changed = true
  }
  return changed ? target : null
}

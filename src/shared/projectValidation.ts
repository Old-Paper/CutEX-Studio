import type { ProjectData } from './types'

export function validateProject(value: unknown): asserts value is ProjectData {
  const project = value as ProjectData | null
  const fail = (): never => { throw new Error('项目文件格式无效或包含损坏的区间；未修改原文件。') }
  if (!project || project.version !== 1 || typeof project.media?.path !== 'string' || !project.media.path || !Number.isFinite(project.media.durationMs) || project.media.durationMs <= 0) fail()
  const p = project!
  if (!Array.isArray(p.deletionRanges) || !Array.isArray(p.rawSilences) || !Array.isArray(p.media.audioTracks) || !p.detectionParameters) fail()
  const ids = new Set<string>()
  for (const range of p.deletionRanges) {
    if (!range || typeof range.id !== 'string' || ids.has(range.id) || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.startMs < 0 || range.endMs <= range.startMs || range.endMs > p.media.durationMs || typeof range.enabled !== 'boolean' || !['manual', 'detected'].includes(range.source)) fail()
    for (const key of ['overrideStartMs', 'overrideEndMs'] as const) if (range[key] !== undefined && !Number.isFinite(range[key])) fail()
    ids.add(range.id)
  }
  for (const range of p.rawSilences) if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) fail()
  for (const key of ['thresholdDb', 'minimumSilenceMs', 'keepBeforeMs', 'keepAfterMs', 'minimumKeepMs', 'mergeGapMs'] as const) if (!Number.isFinite(p.detectionParameters[key])) fail()
  if (!Number.isFinite(p.timelineZoom) || !Number.isFinite(p.lastPlaybackMs)) fail()
}

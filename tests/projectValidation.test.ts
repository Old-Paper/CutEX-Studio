import { expect, it } from 'vitest'
import { validateProject } from '../src/shared/projectValidation'
import { projectSnapshot, useEditorStore } from '../src/renderer/stores/editorStore'
it('rejects incomplete or corrupt project data rather than silently repairing it', () => {
  for (const value of [null, {}, { version: 1, media: { path: 'x', durationMs: NaN } }, { version: 2 }]) expect(() => validateProject(value)).toThrow('未修改原文件')
})
it('validates a snapshot without changing any persisted ranges', () => {
  const project = projectSnapshot({ ...useEditorStore.getInitialState(), media: {
    path: 'source.wav', name: 'source.wav', durationMs: 10000, sizeBytes: 10, hasAudio: true, hasVideo: false, audioTracks: []
  } })!
  const original = JSON.stringify(project)
  validateProject(project)
  expect(JSON.stringify(project)).toBe(original)
  project.deletionRanges = [{ id: 'bad', startMs: 5, endMs: 2, source: 'manual', enabled: true }]
  expect(() => validateProject(project)).toThrow()
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHistory } from '../src/shared/history'
import { markManual, preserveManualEdits } from '../src/shared/ranges'
import type { DeletionRange, MediaInfo, ProjectData } from '../src/shared/types'
import { projectSignature, projectSnapshot, useEditorStore as store } from '../src/renderer/stores/editorStore'

const media: MediaInfo = { path: 'test.mp4', name: 'test.mp4', sizeBytes: 100, durationMs: 10000, hasVideo: true, hasAudio: true,
  audioTracks: [{ streamIndex: 1, ordinal: 0, codec: 'aac', channels: 2, channelLayout: 'stereo', sampleRate: 48000, language: 'und' }] }
const cut: DeletionRange = { id: 'cut', startMs: 2000, endMs: 4000, source: 'detected', enabled: true }
const desktop = {
  confirmReplace: vi.fn(), saveProject: vi.fn(), openProject: vi.fn(), generateWaveform: vi.fn().mockResolvedValue({ peaks: [], rms: [], sampleRate: 48000 }),
  analyzeSilence: vi.fn(), cancelTask: vi.fn().mockResolvedValue(true), selectMedia: vi.fn(), saveRecovery: vi.fn(), startExport: vi.fn(), revealFile: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { desktop })
  store.setState({ ...store.getInitialState(), media, selectedAudioStream: 1, rangeHistory: createHistory([cut], 100) })
  store.setState({ savedSignature: projectSignature(store.getState()) })
})

describe('persistent manual decisions', () => {
  it('preserves a manually shortened sub-second cut after save and reopen', async () => {
    store.getState().selectRange('cut', 'single'); store.getState().setPlayhead(3500); store.getState().trimSelected('left')
    expect(store.getState().isDirty).toBe(true)
    let saved: ProjectData | undefined
    desktop.saveProject.mockImplementation(async (data: ProjectData) => { saved = data; return 'project.cutex.json' })
    expect(await store.getState().saveProject()).toBe(true)
    expect(store.getState().isDirty).toBe(false)
    desktop.openProject.mockResolvedValue({ project: saved, projectPath: 'project.cutex.json', mediaRelocated: false })
    await store.getState().openProject()
    expect(store.getState().rangeHistory.present).toEqual(saved!.deletionRanges)
    expect(saved!.deletionRanges[0]).toMatchObject({ startMs: 3500, endMs: 4000, source: 'manual' })
  })
  it('never silently migrates old short detected ranges on open', async () => {
    const project = projectSnapshot(store.getState())!
    project.deletionRanges = [{ ...cut, endMs: 2500 }]
    desktop.openProject.mockResolvedValue({ project, projectPath: 'old.dubcut.json', mediaRelocated: false })
    await store.getState().openProject()
    expect(store.getState().rangeHistory.present).toEqual(project.deletionRanges)
  })
  it('keeps restored edges when regenerating and supports undo', async () => {
    store.getState().selectRange('cut', 'single'); store.getState().setPlayhead(3500); store.getState().trimSelected('left')
    const before = store.getState().rangeHistory.present
    desktop.analyzeSilence.mockResolvedValue({ rawSilences: [{ id: 'raw', startMs: 1000, endMs: 5000 }] })
    await store.getState().analyze()
    const ranges = store.getState().rangeHistory.present
    expect(ranges.some((r) => r.startMs < 3500 && r.endMs > 2000)).toBe(false)
    expect(ranges.find((r) => r.id === 'cut')).toEqual(before[0])
    store.getState().undo()
    expect(store.getState().rangeHistory.present).toEqual(before)
  })
  it('protects a restored deletion from new detection', () => {
    const result = preserveManualEdits([cut], [markManual(cut, { enabled: false })])
    expect(result).toHaveLength(1); expect(result[0].enabled).toBe(false)
  })
  it('X toggles only the playhead segment and is undoable', () => {
    store.getState().setPlayhead(2500); store.getState().toggleCurrentSegment()
    expect(store.getState().rangeHistory.present[0]).toMatchObject({ enabled: false, source: 'manual' })
    store.getState().undo(); expect(store.getState().rangeHistory.present).toEqual([cut])
  })
})

describe('project lifecycle', () => {
  it('cancel keeps dirty edits intact', async () => {
    store.getState().toggleRangeEnabled('cut'); desktop.confirmReplace.mockResolvedValue('cancel')
    await store.getState().newProject()
    expect(store.getState().media).toEqual(media); expect(store.getState().isDirty).toBe(true)
  })
  it('cancelled save prevents destructive project replacement', async () => {
    store.getState().toggleRangeEnabled('cut'); desktop.confirmReplace.mockResolvedValue('save'); desktop.saveProject.mockResolvedValue(null)
    await store.getState().newProject()
    expect(store.getState().media).toEqual(media)
  })
  it('does not mark newer edits saved when a save completes late', async () => {
    let finish!: (value: string) => void
    desktop.saveProject.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
    const saving = store.getState().saveProject()
    store.getState().toggleRangeEnabled('cut'); finish('project.cutex.json')
    expect(await saving).toBe(false); expect(store.getState().isDirty).toBe(true)
  })
  it('cancelled analysis cannot publish late results', async () => {
    let finish!: (value: unknown) => void
    desktop.analyzeSilence.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const analyzing = store.getState().analyze()
    await store.getState().cancelTask(); finish({ rawSilences: [] }); await analyzing
    expect(store.getState().rangeHistory.present).toEqual([cut])
  })
})

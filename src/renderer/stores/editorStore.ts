import { create } from 'zustand'
import { HISTORY_LIMIT } from '../../shared/constants'
import { createHistory, commitHistory, redoHistory, undoHistory, type HistoryState } from '../../shared/history'
import { createRangeId, deletionToKeepRanges, dropShortDetectedDeletions, enabledDeletions, gapSegmentAtTime, invertRangeSelection, silenceToDeletionRanges, sortRanges, splitRange } from '../../shared/ranges'
import { MINIMUM_AUTOMATIC_SILENCE_MS } from '../../shared/constants'
import type { DeletionRange, DetectionParameters, ExportAcceleration, ExportFormat, ExportMode, MediaInfo, ProjectData, TaskProgress, WaveformData } from '../../shared/types'
import { detectionPreset, type RhythmPreset } from '../../shared/presets'

type ParameterKey = keyof DetectionParameters

interface EditorState {
  media: MediaInfo | null
  projectPath: string | null
  selectedAudioStream: number | null
  parameters: DetectionParameters
  activePreset: RhythmPreset | 'custom'
  waveform: WaveformData | null
  isWaveformLoading: boolean
  isExportDialogOpen: boolean
  rawSilences: import('../../shared/types').TimeRange[]
  rangeHistory: HistoryState<DeletionRange[]>
  selectedIds: string[]
  selectionAnchor: string | null
  playheadMs: number
  zoom: number
  isPlaying: boolean
  isScrubbing: boolean
  task: TaskProgress | null
  error: string | null
  notice: string | null
  editSnapshot: DeletionRange[] | null
  setError(error: string | null): void
  setNotice(notice: string | null): void
  newProject(): void
  importMedia(): Promise<void>
  importDroppedMedia(file: File): Promise<void>
  loadWaveform(): Promise<void>
  openProject(): Promise<void>
  saveProject(saveAs?: boolean): Promise<void>
  analyze(): Promise<void>
  openExportDialog(): void
  closeExportDialog(): void
  exportMedia(format: ExportFormat, acceleration?: ExportAcceleration, mode?: ExportMode): Promise<void>
  cancelTask(): Promise<void>
  setParameter(key: ParameterKey, value: number): void
  applyPreset(preset: RhythmPreset): void
  setAudioStream(streamIndex: number): void
  setPlayhead(ms: number): void
  setZoom(zoom: number): void
  togglePlayback(): void
  setPlaying(value: boolean): void
  setScrubbing(value: boolean): void
  selectRange(id: string, mode: 'single' | 'toggle' | 'extend'): void
  clearSelection(): void
  selectAll(): void
  invertSelection(): void
  setSelectedEnabled(enabled: boolean): void
  setAllEnabled(enabled: boolean): void
  toggleRangeEnabled(id: string): void
  toggleCurrentSegment(): void
  splitSelected(): void
  trimSelected(edge: 'left' | 'right'): void
  undo(): void
  redo(): void
  beginRangeEdit(): void
  previewRange(id: string, startMs: number, endMs: number): void
  endRangeEdit(): void
  applyProgress(progress: TaskProgress): void
}

const initialHistory = (): HistoryState<DeletionRange[]> => createHistory<DeletionRange[]>([], HISTORY_LIMIT)
const taskId = (type: string): string => `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

export const useEditorStore = create<EditorState>((set, get) => ({
  media: null,
  projectPath: null,
  selectedAudioStream: null,
  parameters: detectionPreset('balanced'),
  activePreset: 'balanced',
  waveform: null,
  isWaveformLoading: false,
  isExportDialogOpen: false,
  rawSilences: [],
  rangeHistory: initialHistory(),
  selectedIds: [],
  selectionAnchor: null,
  playheadMs: 0,
  zoom: 1,
  isPlaying: false,
  isScrubbing: false,
  task: null,
  error: null,
  notice: null,
  editSnapshot: null,
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
  newProject: () => set({
    media: null, projectPath: null, selectedAudioStream: null, parameters: detectionPreset('balanced'), activePreset: 'balanced', waveform: null, isWaveformLoading: false, isExportDialogOpen: false,
    rawSilences: [], rangeHistory: initialHistory(), selectedIds: [], selectionAnchor: null,
    playheadMs: 0, zoom: 1, isPlaying: false, isScrubbing: false, task: null, error: null, notice: null, editSnapshot: null
  }),
  importMedia: async () => {
    try {
      set({ error: null, notice: '正在读取媒体信息…' })
      const media = await window.desktop.selectMedia()
      if (!media) return set({ notice: null })
      const currentTask = get().task
      if (currentTask) await window.desktop.cancelTask(currentTask.taskId)
      set({
        media, projectPath: null, selectedAudioStream: media.audioTracks[0]?.streamIndex ?? null,
        rawSilences: [], rangeHistory: initialHistory(), selectedIds: [], selectionAnchor: null,
        playheadMs: 0, zoom: 1, isPlaying: false, isScrubbing: false, waveform: null, task: null, notice: `已导入 ${media.name}，正在自动粗剪…`
      })
      const preset = get().activePreset
      if (preset !== 'custom') get().applyPreset(preset)
      void get().loadWaveform()
      void get().analyze()
    } catch (error) { set({ error: message(error), notice: null }) }
  },
  importDroppedMedia: async (file) => {
    try {
      set({ error: null, notice: '正在读取拖入的媒体…' })
      const media = await window.desktop.importDroppedFile(file)
      const currentTask = get().task
      if (currentTask) await window.desktop.cancelTask(currentTask.taskId)
      set({
        media, projectPath: null, selectedAudioStream: media.audioTracks[0]?.streamIndex ?? null,
        rawSilences: [], rangeHistory: initialHistory(), selectedIds: [], selectionAnchor: null,
        playheadMs: 0, zoom: 1, isPlaying: false, isScrubbing: false, waveform: null, task: null, notice: `已拖入 ${media.name}，正在自动粗剪…`
      })
      const preset = get().activePreset
      if (preset !== 'custom') get().applyPreset(preset)
      void get().loadWaveform()
      void get().analyze()
    } catch (error) { set({ error: message(error), notice: null }) }
  },
  loadWaveform: async () => {
    const state = get()
    if (!state.media?.hasAudio || state.selectedAudioStream === null) return set({ waveform: null, isWaveformLoading: false })
    const mediaPath = state.media.path
    const streamIndex = state.selectedAudioStream
    set({ isWaveformLoading: true })
    try {
      const waveform = await window.desktop.generateWaveform({ path: mediaPath, audioStreamIndex: streamIndex, durationMs: state.media.durationMs, points: 2_400 })
      const latest = get()
      if (latest.media?.path === mediaPath && latest.selectedAudioStream === streamIndex) set({ waveform, isWaveformLoading: false })
    } catch (error) {
      if (get().media?.path === mediaPath) set({ waveform: null, isWaveformLoading: false, error: message(error) })
    }
  },
  openProject: async () => {
    try {
      const result = await window.desktop.openProject()
      if (!result) return
      const project = result.project
      set({
        media: project.media, projectPath: result.projectPath, selectedAudioStream: project.selectedAudioStream,
        parameters: project.detectionParameters, activePreset: 'custom', rawSilences: project.rawSilences,
        rangeHistory: createHistory(dropShortDetectedDeletions(project.deletionRanges), HISTORY_LIMIT), selectedIds: [], selectionAnchor: null,
        playheadMs: project.lastPlaybackMs, zoom: project.timelineZoom, isPlaying: false, isScrubbing: false,
        waveform: null, notice: result.mediaRelocated ? '项目已打开，媒体已重新定位。' : '项目已打开。', error: null
      })
      void get().loadWaveform()
    } catch (error) { set({ error: message(error) }) }
  },
  saveProject: async (saveAs = false) => {
    const state = get()
    if (!state.media) return
    try {
      const deletions = state.rangeHistory.present
      const project: ProjectData = {
        version: 1, savedAt: new Date().toISOString(), projectPath: state.projectPath ?? undefined,
        media: state.media, selectedAudioStream: state.selectedAudioStream,
        detectionParameters: state.parameters, rawSilences: state.rawSilences,
        deletionRanges: deletions,
        keepRanges: deletionToKeepRanges(enabledDeletions(deletions), state.media.durationMs),
        timelineZoom: state.zoom, lastPlaybackMs: state.playheadMs
      }
      const path = await window.desktop.saveProject(project, saveAs)
      if (path) set({ projectPath: path, notice: '项目已保存。', error: null })
    } catch (error) { set({ error: message(error) }) }
  },
  analyze: async () => {
    const state = get()
    if (!state.media?.hasAudio || state.selectedAudioStream === null) return set({ error: '当前媒体没有可分析的音轨。' })
    const mediaPath = state.media.path
    const id = taskId('analysis')
    set({ task: { taskId: id, type: 'analysis', percent: 0, processedMs: 0, message: '准备分析…' }, error: null })
    try {
      const result = await window.desktop.analyzeSilence({
        taskId: id, media: state.media, audioStreamIndex: state.selectedAudioStream, parameters: state.parameters
      })
      const ranges = silenceToDeletionRanges(result.rawSilences, state.media.durationMs, state.parameters)
      if (get().media?.path !== mediaPath || get().task?.taskId !== id) return
      set({ rawSilences: result.rawSilences, rangeHistory: createHistory(ranges, HISTORY_LIMIT), selectedIds: [], task: null, notice: `分析完成，发现 ${ranges.length} 个建议删除区间。` })
    } catch (error) {
      if (get().media?.path === mediaPath && get().task?.taskId === id) set({ task: null, error: message(error) })
    }
  },
  openExportDialog: () => set({ isExportDialogOpen: true }),
  closeExportDialog: () => set({ isExportDialogOpen: false }),
  exportMedia: async (format, acceleration = 'cpu', mode = 'fast') => {
    const state = get()
    if (!state.media) return
    const keepRanges = deletionToKeepRanges(enabledDeletions(state.rangeHistory.present), state.media.durationMs)
    if (!keepRanges.length) return set({ error: '所有内容都被标记删除，无法导出。' })
    const id = taskId('export')
    set({ isExportDialogOpen: false, task: { taskId: id, type: 'export', percent: 0, processedMs: 0, message: '等待选择输出位置…' }, error: null })
    try {
      const result = await window.desktop.startExport({
        taskId: id, inputPath: state.media.path, keepRanges, durationMs: state.media.durationMs,
        hasVideo: state.media.hasVideo, hasAudio: state.media.hasAudio, audioStreamIndex: state.selectedAudioStream ?? undefined, format, acceleration, mode
      })
      if (!result) return set({ task: null })
      const fallbackNotice = result.modeFallback
        ? '快速模式不兼容，已自动用高精度模式完成导出'
        : result.fallbackFrom
          ? 'GPU 不可用，已自动用 CPU 完成导出'
          : result.mode === 'fast' ? '快速导出完成' : '高精度导出完成'
      set({ task: null, notice: `${fallbackNotice}：${result.outputPath}` })
      await window.desktop.revealFile(result.outputPath)
    } catch (error) { set({ task: null, error: message(error) }) }
  },
  cancelTask: async () => {
    const current = get().task
    if (current) await window.desktop.cancelTask(current.taskId)
  },
  setParameter: (key, value) => set((state) => ({
    parameters: {
      ...state.parameters,
      [key]: key === 'minimumSilenceMs'
        ? Math.max(MINIMUM_AUTOMATIC_SILENCE_MS, Math.round(value))
        : Math.round(value)
    },
    activePreset: 'custom'
  })),
  applyPreset: (activePreset) => set((state) => ({ activePreset, parameters: detectionPreset(activePreset, state.media?.frameRate) })),
  setAudioStream: (selectedAudioStream) => { set({ selectedAudioStream, waveform: null }); void get().loadWaveform() },
  setPlayhead: (playheadMs) => set((state) => ({ playheadMs: Math.min(state.media?.durationMs ?? 0, Math.max(0, Math.round(playheadMs))) })),
  setZoom: (zoom) => set({ zoom: Math.min(12, Math.max(1, zoom)) }),
  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setScrubbing: (isScrubbing) => set({ isScrubbing }),
  selectRange: (id, mode) => set((state) => {
    const allIds = state.rangeHistory.present.map((range) => range.id)
    if (mode === 'toggle') {
      const selectedIds = state.selectedIds.includes(id) ? state.selectedIds.filter((item) => item !== id) : [...state.selectedIds, id]
      return { selectedIds, selectionAnchor: id }
    }
    if (mode === 'extend' && state.selectionAnchor) {
      const start = allIds.indexOf(state.selectionAnchor), end = allIds.indexOf(id)
      if (start >= 0 && end >= 0) return { selectedIds: allIds.slice(Math.min(start, end), Math.max(start, end) + 1) }
    }
    return { selectedIds: [id], selectionAnchor: id }
  }),
  clearSelection: () => set({ selectedIds: [], selectionAnchor: null }),
  selectAll: () => set((state) => ({ selectedIds: state.rangeHistory.present.map((range) => range.id) })),
  invertSelection: () => set((state) => ({ selectedIds: invertRangeSelection(state.rangeHistory.present.map((range) => range.id), state.selectedIds) })),
  setSelectedEnabled: (enabled) => set((state) => ({ rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => state.selectedIds.includes(range.id) ? { ...range, enabled } : range)) })),
  setAllEnabled: (enabled) => set((state) => ({ rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => ({ ...range, enabled }))) })),
  toggleRangeEnabled: (id) => set((state) => ({ rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => range.id === id ? { ...range, enabled: !range.enabled } : range)) })),
  toggleCurrentSegment: () => set((state) => {
    if (!state.media) return {}
    const durationMs = state.media.durationMs
    const atMs = Math.min(Math.max(0, durationMs - 1), Math.max(0, state.playheadMs))
    const current = state.rangeHistory.present.find((range) => atMs >= range.startMs && atMs < range.endMs)

    if (current) {
      const enabled = !current.enabled
      const next = state.rangeHistory.present.map((range) => range.id === current.id ? { ...range, enabled } : range)
      return {
        rangeHistory: commitHistory(state.rangeHistory, next),
        selectedIds: [current.id], selectionAnchor: current.id,
        notice: enabled ? '当前片段已标记删除，播放会立即跳过。' : '当前片段已恢复保留。'
      }
    }

    const segment = gapSegmentAtTime(state.rangeHistory.present, atMs, durationMs)
    if (!segment) return { notice: '播放头不在可反选的片段内。' }
    const manual: DeletionRange = { ...segment, id: createRangeId('manual'), enabled: true, source: 'manual' }
    return {
      rangeHistory: commitHistory(state.rangeHistory, sortRanges([...state.rangeHistory.present, manual])),
      selectedIds: [manual.id], selectionAnchor: manual.id,
      notice: '当前片段已标记删除，播放会立即跳过。'
    }
  }),
  splitSelected: () => set((state) => {
    const next = state.rangeHistory.present.flatMap((range) => {
      if (!state.selectedIds.includes(range.id)) return [range]
      return splitRange(range, state.playheadMs) ?? [range]
    })
    return { rangeHistory: commitHistory(state.rangeHistory, next), selectedIds: [] }
  }),
  trimSelected: (edge) => set((state) => ({
    rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => {
      if (!state.selectedIds.includes(range.id)) return range
      if (edge === 'left' && state.playheadMs < range.endMs) return { ...range, startMs: Math.max(0, state.playheadMs) }
      if (edge === 'right' && state.playheadMs > range.startMs) return { ...range, endMs: Math.min(state.media?.durationMs ?? range.endMs, state.playheadMs) }
      return range
    }))
  })),
  undo: () => set((state) => ({ rangeHistory: undoHistory(state.rangeHistory), selectedIds: [] })),
  redo: () => set((state) => ({ rangeHistory: redoHistory(state.rangeHistory), selectedIds: [] })),
  beginRangeEdit: () => set((state) => ({ editSnapshot: state.rangeHistory.present })),
  previewRange: (id, startMs, endMs) => set((state) => ({ rangeHistory: { ...state.rangeHistory, present: state.rangeHistory.present.map((range) => range.id === id ? { ...range, startMs, endMs } : range) } })),
  endRangeEdit: () => set((state) => {
    if (!state.editSnapshot) return {}
    return { rangeHistory: { ...state.rangeHistory, past: [...state.rangeHistory.past, state.editSnapshot].slice(-state.rangeHistory.limit), future: [] }, editSnapshot: null }
  }),
  applyProgress: (progress) => set((state) => state.task?.taskId === progress.taskId ? { task: progress } : {})
}))

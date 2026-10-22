import { create } from 'zustand'
import { HISTORY_LIMIT } from '../../shared/constants'
import { createHistory, commitHistory, redoHistory, undoHistory, type HistoryState } from '../../shared/history'
import { createRangeId, deletionToKeepRanges, enabledDeletions, gapSegmentAtTime, invertRangeSelection, markManual, preserveManualEdits, silenceToDeletionRanges, sortRanges, splitRange } from '../../shared/ranges'
import { MINIMUM_AUTOMATIC_SILENCE_MS } from '../../shared/constants'
import type { DeletionRange, DetectionParameters, ExportAcceleration, ExportFormat, ExportMode, MediaInfo, ProjectData, TaskProgress, WaveformData } from '../../shared/types'
import { detectionPreset, type RhythmPreset } from '../../shared/presets'

type ParameterKey = keyof DetectionParameters

interface EditorState {
  isDirty: boolean
  savedSignature: string | null
  isReplacing: boolean
  previewMode: 'original' | 'edited'
  setPreviewMode(mode: 'original' | 'edited'): void
  restoreRecovery(): Promise<void>
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
  newProject(): Promise<void>
  importMedia(): Promise<void>
  importDroppedMedia(file: File): Promise<void>
  loadWaveform(): Promise<void>
  openProject(): Promise<void>
  saveProject(saveAs?: boolean): Promise<boolean>
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

export function projectSnapshot(state: EditorState): ProjectData | null {
  if (!state.media) return null
  return { version: 1, savedAt: new Date().toISOString(), projectPath: state.projectPath ?? undefined,
    media: state.media, selectedAudioStream: state.selectedAudioStream, detectionParameters: state.parameters,
    rawSilences: state.rawSilences, deletionRanges: state.rangeHistory.present,
    keepRanges: deletionToKeepRanges(enabledDeletions(state.rangeHistory.present), state.media.durationMs),
    timelineZoom: state.zoom, lastPlaybackMs: state.playheadMs }
}

export function projectSignature(state: Pick<EditorState, 'media' | 'selectedAudioStream' | 'parameters' | 'rawSilences' | 'rangeHistory'>): string {
  return JSON.stringify([state.media, state.selectedAudioStream, state.parameters, state.rawSilences, state.rangeHistory.present])
}

async function allowReplace(get: () => EditorState): Promise<boolean> {
  if (get().task) { get().setError('请先取消或等待当前任务完成，再切换项目。'); return false }
  if (!get().isDirty) return true
  const choice = await window.desktop.confirmReplace()
  if (choice === 'cancel') return false
  if (choice === 'save') return get().saveProject()
  return true
}

function loadedState(project: ProjectData, projectPath: string): Partial<EditorState> {
  const fields = { media: project.media, projectPath: projectPath || null, selectedAudioStream: project.selectedAudioStream,
    parameters: project.detectionParameters, rawSilences: project.rawSilences,
    rangeHistory: createHistory(project.deletionRanges, HISTORY_LIMIT) }
  return { ...fields, savedSignature: projectSignature(fields), activePreset: 'custom', selectedIds: [], selectionAnchor: null,
    playheadMs: project.lastPlaybackMs, zoom: Math.min(256, Math.max(1, project.timelineZoom)), isPlaying: false,
    isScrubbing: false, waveform: null, task: null, editSnapshot: null, error: null }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  isDirty: false, savedSignature: null, isReplacing: false, previewMode: 'original',
  setPreviewMode: (previewMode) => set({ previewMode }),
  restoreRecovery: async () => {
    if (get().media || get().isReplacing) return
    set({ isReplacing: true })
    try {
      const result = await window.desktop.recoverProject()
      if (result) { set({ ...loadedState(result.project, result.projectPath), savedSignature: null, notice: '已恢复快照，请保存项目。' }); void get().loadWaveform() }
    } catch (error) { set({ error: message(error) }) } finally { set({ isReplacing: false }) }
  },
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
  newProject: async () => {
    if (get().isReplacing) return
    set({ isReplacing: true })
    try {
      if (!(await allowReplace(get))) return
      await window.desktop.saveRecovery(null)
      set({
    media: null, projectPath: null, selectedAudioStream: null, parameters: detectionPreset('balanced'), activePreset: 'balanced', waveform: null, isWaveformLoading: false, isExportDialogOpen: false,
    rawSilences: [], rangeHistory: initialHistory(), selectedIds: [], selectionAnchor: null,
    playheadMs: 0, zoom: 1, isPlaying: false, isScrubbing: false, task: null, error: null, notice: null, editSnapshot: null, savedSignature: null
      })
    } catch (error) { set({ error: message(error) }) } finally { set({ isReplacing: false }) }
  },
  importMedia: async () => {
    if (get().isReplacing) return
    set({ isReplacing: true })
    try {
      if (!(await allowReplace(get))) return
      set({ error: null, notice: '正在读取媒体信息…' })
      const media = await window.desktop.selectMedia()
      if (!media) return set({ notice: null })
      const currentTask = get().task
      if (currentTask) await window.desktop.cancelTask(currentTask.taskId)
      set({
        media, projectPath: null, savedSignature: null, editSnapshot: null, selectedAudioStream: media.audioTracks[0]?.streamIndex ?? null,
        rawSilences: [], rangeHistory: initialHistory(), selectedIds: [], selectionAnchor: null,
        playheadMs: 0, zoom: 1, isPlaying: false, isScrubbing: false, waveform: null, task: null, notice: `已导入 ${media.name}，正在自动粗剪…`
      })
      const preset = get().activePreset
      if (preset !== 'custom') get().applyPreset(preset)
      void get().loadWaveform()
      void get().analyze()
    } catch (error) { set({ error: message(error), notice: null }) } finally { set({ isReplacing: false }) }
  },
  importDroppedMedia: async (file) => {
    if (get().isReplacing) return
    set({ isReplacing: true })
    try {
      if (!(await allowReplace(get))) return
      set({ error: null, notice: '正在读取拖入的媒体…' })
      const media = await window.desktop.importDroppedFile(file)
      const currentTask = get().task
      if (currentTask) await window.desktop.cancelTask(currentTask.taskId)
      set({
        media, projectPath: null, savedSignature: null, editSnapshot: null, selectedAudioStream: media.audioTracks[0]?.streamIndex ?? null,
        rawSilences: [], rangeHistory: initialHistory(), selectedIds: [], selectionAnchor: null,
        playheadMs: 0, zoom: 1, isPlaying: false, isScrubbing: false, waveform: null, task: null, notice: `已拖入 ${media.name}，正在自动粗剪…`
      })
      const preset = get().activePreset
      if (preset !== 'custom') get().applyPreset(preset)
      void get().loadWaveform()
      void get().analyze()
    } catch (error) { set({ error: message(error), notice: null }) } finally { set({ isReplacing: false }) }
  },
  loadWaveform: async () => {
    const state = get()
    if (!state.media?.hasAudio || state.selectedAudioStream === null) return set({ waveform: null, isWaveformLoading: false })
    const mediaPath = state.media.path
    const streamIndex = state.selectedAudioStream
    set({ isWaveformLoading: true })
    try {
      const waveform = await window.desktop.generateWaveform({ path: mediaPath, audioStreamIndex: streamIndex, durationMs: state.media.durationMs, points: Math.ceil(state.media.durationMs / 10) })
      const latest = get()
      if (latest.media === state.media && latest.selectedAudioStream === streamIndex) set({ waveform, isWaveformLoading: false })
    } catch (error) {
      if (get().media === state.media && get().selectedAudioStream === streamIndex) set({ waveform: null, isWaveformLoading: false, error: message(error) })
    }
  },
  openProject: async () => {
    if (get().isReplacing) return
    set({ isReplacing: true })
    try {
      if (!(await allowReplace(get))) return
      const result = await window.desktop.openProject()
      if (!result) return
      const project = result.project
      set({ ...loadedState(project, result.projectPath), notice: result.mediaRelocated ? '项目已打开，媒体已重新定位。' : '项目已打开。' })
      void get().loadWaveform()
    } catch (error) { set({ error: message(error) }) } finally { set({ isReplacing: false }) }
  },
  saveProject: async (saveAs = false) => {
    const state = get()
    if (!state.media) return false
    try {
      const project = projectSnapshot(state)!
      const signature = projectSignature(state)
      const path = await window.desktop.saveProject(project, saveAs)
      if (path && get().media === state.media) set({ projectPath: path, savedSignature: signature, notice: '项目已保存。', error: null })
      return Boolean(path) && !get().isDirty
    } catch (error) { set({ error: message(error) }); return false }
  },
  analyze: async () => {
    const state = get()
    if (state.task) return
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
      set((latest) => ({ rawSilences: result.rawSilences, rangeHistory: commitHistory(latest.rangeHistory, preserveManualEdits(ranges, latest.rangeHistory.present)), selectedIds: [], task: null, notice: `分析完成，发现 ${ranges.length} 个建议区间；手动决定已保留，可撤销。` }))
    } catch (error) {
      if (get().media?.path === mediaPath && get().task?.taskId === id) set({ task: null, error: message(error) })
    }
  },
  openExportDialog: () => set({ isExportDialogOpen: true }),
  closeExportDialog: () => set({ isExportDialogOpen: false }),
  exportMedia: async (format, acceleration = 'cpu', mode = 'fast') => {
    const state = get()
    if (!state.media || state.task || state.isReplacing) return
    const keepRanges = deletionToKeepRanges(enabledDeletions(state.rangeHistory.present), state.media.durationMs)
    if (!keepRanges.length) return set({ error: '所有内容都被标记删除，无法导出。' })
    const id = taskId('export')
    set({ isExportDialogOpen: false, task: { taskId: id, type: 'export', percent: 0, processedMs: 0, message: '等待选择输出位置…' }, error: null })
    try {
      const result = await window.desktop.startExport({
        taskId: id, inputPath: state.media.path, keepRanges, durationMs: state.media.durationMs,
        hasVideo: state.media.hasVideo, hasAudio: state.media.hasAudio, audioStreamIndex: state.selectedAudioStream ?? undefined, format, acceleration, mode
      })
      if (get().task?.taskId !== id) return
      if (!result) return set({ task: null })
      const fallbackNotice = result.modeFallback
        ? '快速模式不兼容，已自动用高精度模式完成导出'
        : result.fallbackFrom
          ? 'GPU 不可用，已自动用 CPU 完成导出'
          : result.mode === 'fast' ? '快速导出完成' : '高精度导出完成'
      set({ task: null, notice: `${fallbackNotice}：${result.outputPath}` })
      await window.desktop.revealFile(result.outputPath)
    } catch (error) { if (get().task?.taskId === id) set({ task: null, error: message(error) }) }
  },
  cancelTask: async () => {
    const current = get().task
    if (current) {
      await window.desktop.cancelTask(current.taskId)
      if (get().task?.taskId === current.taskId) set({ task: null, notice: '任务已取消。' })
    }
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
  setAudioStream: (selectedAudioStream) => {
    if (get().task || get().selectedAudioStream === selectedAudioStream) return
    set({ selectedAudioStream, waveform: null, isPlaying: false })
    void get().loadWaveform(); void get().analyze()
  },
  setPlayhead: (playheadMs) => set((state) => ({ playheadMs: Math.min(state.media?.durationMs ?? 0, Math.max(0, Math.round(playheadMs))) })),
  setZoom: (zoom) => set({ zoom: Math.min(256, Math.max(1, zoom)) }),
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
  setSelectedEnabled: (enabled) => set((state) => ({ rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => state.selectedIds.includes(range.id) ? markManual(range, { enabled }) : range)) })),
  setAllEnabled: (enabled) => set((state) => ({ rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => markManual(range, { enabled }))) })),
  toggleRangeEnabled: (id) => set((state) => ({ rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => range.id === id ? markManual(range, { enabled: !range.enabled }) : range)) })),
  toggleCurrentSegment: () => set((state) => {
    if (!state.media) return {}
    const durationMs = state.media.durationMs
    const atMs = Math.min(Math.max(0, durationMs - 1), Math.max(0, state.playheadMs))
    const current = state.rangeHistory.present.find((range) => atMs >= range.startMs && atMs < range.endMs)

    if (current) {
      const enabled = !current.enabled
      const next = state.rangeHistory.present.map((range) => range.id === current.id ? markManual(range, { enabled }) : range)
      return {
        rangeHistory: commitHistory(state.rangeHistory, next),
        selectedIds: [current.id], selectionAnchor: current.id,
        notice: enabled ? '当前片段已标记删除，成片预览会跳过。' : '当前片段已恢复保留。'
      }
    }

    const segment = gapSegmentAtTime(state.rangeHistory.present, atMs, durationMs)
    if (!segment) return { notice: '播放头不在可反选的片段内。' }
    const manual: DeletionRange = { ...segment, id: createRangeId('manual'), enabled: true, source: 'manual' }
    return {
      rangeHistory: commitHistory(state.rangeHistory, sortRanges([...state.rangeHistory.present, manual])),
      selectedIds: [manual.id], selectionAnchor: manual.id,
      notice: '当前片段已标记删除，成片预览会跳过。'
    }
  }),
  splitSelected: () => set((state) => {
    const next = state.rangeHistory.present.flatMap((range) => {
      if (!state.selectedIds.includes(range.id)) return [range]
      return splitRange(markManual(range), state.playheadMs) ?? [range]
    })
    return { rangeHistory: commitHistory(state.rangeHistory, next), selectedIds: [] }
  }),
  trimSelected: (edge) => set((state) => ({
    rangeHistory: commitHistory(state.rangeHistory, state.rangeHistory.present.map((range) => {
      if (!state.selectedIds.includes(range.id)) return range
      if (edge === 'left' && state.playheadMs > range.startMs && state.playheadMs < range.endMs) return markManual(range, { startMs: state.playheadMs })
      if (edge === 'right' && state.playheadMs > range.startMs && state.playheadMs < range.endMs) return markManual(range, { endMs: state.playheadMs })
      return range
    }))
  })),
  undo: () => set((state) => ({ rangeHistory: undoHistory(state.rangeHistory), selectedIds: [] })),
  redo: () => set((state) => ({ rangeHistory: redoHistory(state.rangeHistory), selectedIds: [] })),
  beginRangeEdit: () => set((state) => ({ editSnapshot: state.rangeHistory.present })),
  previewRange: (id, startMs, endMs) => set((state) => ({ rangeHistory: { ...state.rangeHistory, present: state.rangeHistory.present.map((range) => range.id === id ? markManual(range, { startMs, endMs }) : range) } })),
  endRangeEdit: () => set((state) => {
    if (!state.editSnapshot) return {}
    return { rangeHistory: { ...state.rangeHistory, past: [...state.rangeHistory.past, state.editSnapshot].slice(-state.rangeHistory.limit), future: [] }, editSnapshot: null }
  }),
  applyProgress: (progress) => set((state) => state.task?.taskId === progress.taskId ? { task: progress } : {})
}))

useEditorStore.subscribe((state, previous) => {
  if (state.media === previous.media && state.rangeHistory.present === previous.rangeHistory.present && state.parameters === previous.parameters && state.selectedAudioStream === previous.selectedAudioStream && state.rawSilences === previous.rawSilences && state.savedSignature === previous.savedSignature) return
  const isDirty = Boolean(state.media) && projectSignature(state) !== state.savedSignature
  if (isDirty !== state.isDirty) useEditorStore.setState({ isDirty })
})

import type { ExportAcceleration, ExportOptions, TimeRange } from './types'
import { exportFormatInfo } from './exportFormats'

const seconds = (ms: number): string => (Math.max(0, Math.round(ms)) / 1000).toFixed(3)

function filterForRanges(ranges: TimeRange[], hasVideo: boolean, hasAudio: boolean, audioStreamIndex = 0): string {
  const filters: string[] = []
  const concatInputs: string[] = []
  ranges.forEach((range, index) => {
    if (hasVideo) {
      filters.push(`[0:v:0]trim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},setpts=PTS-STARTPTS[v${index}]`)
      concatInputs.push(`[v${index}]`)
    }
    if (hasAudio) {
      filters.push(`[0:${audioStreamIndex}]atrim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},asetpts=PTS-STARTPTS[a${index}]`)
      concatInputs.push(`[a${index}]`)
    }
  })
  const outputs = `${hasVideo ? '[vout]' : ''}${hasAudio ? '[aout]' : ''}`
  filters.push(`${concatInputs.join('')}concat=n=${ranges.length}:v=${hasVideo ? 1 : 0}:a=${hasAudio ? 1 : 0}${outputs}`)
  return filters.join(';')
}

function h264EncoderArgs(acceleration: ExportAcceleration): string[] {
  if (acceleration === 'nvidia') return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq:v', '19', '-b:v', '0', '-pix_fmt', 'yuv420p']
  if (acceleration === 'intel') return ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '20', '-pix_fmt', 'yuv420p']
  if (acceleration === 'amd') return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20', '-pix_fmt', 'yuv420p']
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']
}

function appendOutputArgs(args: string[], options: ExportOptions, includeVideo: boolean, includeAudio: boolean): void {
  const acceleration = options.acceleration ?? 'cpu'
  if (includeVideo) {
    if (options.format === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-threads', '0')
    else args.push(...h264EncoderArgs(acceleration))
  }
  if (includeAudio) {
    if (options.format === 'webm') args.push('-c:a', 'libopus', '-b:a', '160k')
    else if (options.format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '192k')
    else if (options.format === 'wav') args.push('-c:a', 'pcm_s16le')
    else args.push('-c:a', 'aac', '-b:a', '192k')
  }
  if (options.format === 'mp4' || options.format === 'mov' || options.format === 'm4a') args.push('-movflags', '+faststart')
  args.push('-progress', 'pipe:2', options.outputPath!)
}

export function buildExportArgs(options: ExportOptions): string[] {
  const format = exportFormatInfo(options.format)
  const includeVideo = options.hasVideo && format.kind === 'video'
  const includeAudio = options.hasAudio
  if (!options.keepRanges.length) throw new Error('没有可导出的保留区间。')
  if (!includeVideo && !includeAudio) throw new Error('输入文件不包含可导出的音视频流。')
  if (format.kind === 'video' && !options.hasVideo) throw new Error('纯音频素材不能导出为视频格式。')
  if (!options.outputPath) throw new Error('尚未选择输出路径。')

  const args = ['-hide_banner', '-y', '-i', options.inputPath]
  args.push('-filter_complex', filterForRanges(options.keepRanges, includeVideo, includeAudio, options.audioStreamIndex ?? 0))
  if (includeVideo) {
    args.push('-map', '[vout]')
  }
  if (includeAudio) {
    args.push('-map', '[aout]')
  }
  appendOutputArgs(args, options, includeVideo, includeAudio)
  return args
}

export function buildConcatList(inputPath: string, ranges: TimeRange[]): string {
  const escapedPath = inputPath.replace(/\\/g, '/').replace(/'/g, `'\\''`)
  const lines = ['ffconcat version 1.0']
  for (const range of ranges) {
    lines.push(`file '${escapedPath}'`, `inpoint ${seconds(range.startMs)}`, `outpoint ${seconds(range.endMs)}`)
  }
  return `${lines.join('\n')}\n`
}

export function buildFastExportArgs(options: ExportOptions, concatListPath: string): string[] {
  const format = exportFormatInfo(options.format)
  const includeVideo = options.hasVideo && format.kind === 'video'
  const includeAudio = options.hasAudio
  if (!options.keepRanges.length) throw new Error('没有可导出的保留区间。')
  if (!includeVideo && !includeAudio) throw new Error('输入文件不包含可导出的音视频流。')
  if (format.kind === 'video' && !options.hasVideo) throw new Error('纯音频素材不能导出为视频格式。')
  if (!options.outputPath) throw new Error('尚未选择输出路径。')

  const outputDurationMs = options.keepRanges.reduce((sum, range) => sum + range.endMs - range.startMs, 0)
  const args = ['-hide_banner', '-y', '-segment_time_metadata', '1', '-f', 'concat', '-safe', '0', '-i', concatListPath]
  if (includeVideo) args.push('-map', '0:v:0', '-vf', 'select=concatdec_select,setpts=PTS-STARTPTS')
  if (includeAudio) {
    const audioStreamIndex = options.audioStreamIndex ?? 0
    args.push('-map', `0:${audioStreamIndex}`, '-af', `aselect=concatdec_select,asetpts=PTS-STARTPTS,apad=whole_dur=${seconds(outputDurationMs)},atrim=end=${seconds(outputDurationMs)}`)
  }
  args.push('-max_muxing_queue_size', '2048')
  appendOutputArgs(args, options, includeVideo, includeAudio)
  return args
}

export function externalizeComplexFilter(args: string[], filterScriptPath: string): { args: string[]; filterGraph: string } {
  const filterIndex = args.indexOf('-filter_complex')
  const filterGraph = args[filterIndex + 1]
  if (filterIndex < 0 || !filterGraph) throw new Error('导出参数中缺少复杂滤镜。')
  const externalized = [...args]
  externalized.splice(filterIndex, 2, '-filter_complex_script', filterScriptPath)
  return { args: externalized, filterGraph }
}

import { describe, expect, it } from 'vitest'
import { buildConcatList, buildExportArgs, buildFastExportArgs, externalizeComplexFilter } from '../src/shared/exportArgs'

const base = { taskId: 'test', inputPath: 'C:\\素材 文件\\配音.mp4', outputPath: 'D:\\导出 文件\\成片.mp4', durationMs: 10_000, keepRanges: [{ id: 'a', startMs: 0, endMs: 1000 }, { id: 'b', startMs: 2000, endMs: 4000 }], hasVideo: true, hasAudio: true, audioStreamIndex: 1, format: 'mp4' as const }

describe('buildExportArgs', () => {
  it('builds trim, timestamp reset and concat filters for video and audio', () => {
    const args = buildExportArgs(base)
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('[0:v:0]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS[v0]')
    expect(filter).toContain('[0:1]atrim=start=2.000:end=4.000,asetpts=PTS-STARTPTS[a1]')
    expect(filter).toContain('concat=n=2:v=1:a=1[vout][aout]')
  })
  it('keeps Chinese paths with spaces as single argument array entries', () => {
    const args = buildExportArgs(base)
    expect(args).toContain(base.inputPath)
    expect(args).toContain(base.outputPath)
    expect(args.filter((arg) => arg === base.inputPath)).toHaveLength(1)
  })
  it('builds audio-only output', () => {
    const args = buildExportArgs({ ...base, hasVideo: false, outputPath: 'out.m4a', format: 'm4a' })
    expect(args).not.toContain('-c:v')
    expect(args).toContain('-c:a')
  })
  it('rejects an export with no retained content', () => expect(() => buildExportArgs({ ...base, keepRanges: [] })).toThrow(/保留区间/))
  it('uses VP9 and Opus for WebM', () => {
    const args = buildExportArgs({ ...base, format: 'webm', outputPath: 'out.webm' })
    expect(args).toContain('libvpx-vp9')
    expect(args).toContain('libopus')
    expect(args).toContain('-row-mt')
    expect(args).toContain('-cpu-used')
  })
  it('extracts MP3 and WAV audio without a video map', () => {
    const mp3 = buildExportArgs({ ...base, format: 'mp3', outputPath: 'out.mp3' })
    const wav = buildExportArgs({ ...base, format: 'wav', outputPath: 'out.wav' })
    expect(mp3).toContain('libmp3lame')
    expect(wav).toContain('pcm_s16le')
    expect(mp3).not.toContain('[vout]')
  })
  it('keeps H.264 for MOV and MKV while faststart is container-specific', () => {
    const mov = buildExportArgs({ ...base, format: 'mov', outputPath: 'out.mov' })
    const mkv = buildExportArgs({ ...base, format: 'mkv', outputPath: 'out.mkv' })
    expect(mov).toContain('libx264')
    expect(mov).toContain('veryfast')
    expect(mov).toContain('+faststart')
    expect(mkv).toContain('libx264')
    expect(mkv).not.toContain('+faststart')
  })
  it('selects each supported H.264 GPU encoder while keeping WebM on VP9', () => {
    const nvidia = buildExportArgs({ ...base, acceleration: 'nvidia' })
    const intel = buildExportArgs({ ...base, acceleration: 'intel' })
    const amd = buildExportArgs({ ...base, acceleration: 'amd' })
    const webm = buildExportArgs({ ...base, format: 'webm', outputPath: 'out.webm', acceleration: 'nvidia' })
    expect(nvidia).toContain('h264_nvenc')
    expect(intel).toContain('h264_qsv')
    expect(amd).toContain('h264_amf')
    expect(webm).toContain('libvpx-vp9')
    expect(webm).not.toContain('h264_nvenc')
  })
  it('moves a very large filter graph out of the Windows command line', () => {
    const keepRanges = Array.from({ length: 400 }, (_, index) => ({
      id: `keep-${index}`, startMs: index * 20, endMs: index * 20 + 10
    }))
    const inline = buildExportArgs({ ...base, durationMs: 8_000, keepRanges })
    expect(inline.join(' ').length).toBeGreaterThan(32_767)

    const scriptPath = 'C:\\Temp\\cutex-filter.txt'
    const result = externalizeComplexFilter(inline, scriptPath)
    expect(result.filterGraph).toContain('concat=n=400:v=1:a=1[vout][aout]')
    expect(result.args).toContain('-filter_complex_script')
    expect(result.args).toContain(scriptPath)
    expect(result.args).not.toContain(result.filterGraph)
    expect(result.args.join(' ').length).toBeLessThan(1_000)
  })
  it('builds a one-pass segment export without hundreds of trim branches', () => {
    const list = buildConcatList(base.inputPath, base.keepRanges)
    const args = buildFastExportArgs({ ...base, mode: 'fast', acceleration: 'nvidia' }, 'C:\\Temp\\segments.ffconcat')
    expect(list).toContain("file 'C:/素材 文件/配音.mp4'")
    expect(list).toContain('inpoint 2.000')
    expect(args).toContain('-segment_time_metadata')
    expect(args).toContain('select=concatdec_select,setpts=PTS-STARTPTS')
    expect(args).toContain('h264_nvenc')
    expect(args.join(' ')).not.toContain('trim=start=')
    expect(args).not.toContain('-filter_complex')
  })
})

import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { MediaInfo } from '../../shared/types'
import { ffmpegPath } from './binaries'
import { registerTask } from './taskManager'

const pending = new Map<string, Promise<string>>()
/** Chromium does not reliably expose audioTracks. Remux an explicitly selected track. */
export async function previewPath(media: MediaInfo, streamIndex: number | null, cacheDirectory: string): Promise<string> {
  if (media.audioTracks.length <= 1 || streamIndex === null) return media.path
  if (!media.audioTracks.some((track) => track.streamIndex === streamIndex)) throw new Error('所选音轨不存在。')
  const file = await stat(media.path)
  const key = createHash('sha256').update(JSON.stringify([media.path, file.size, file.mtimeMs, streamIndex])).digest('hex')
  const target = join(cacheDirectory, `${key}.${media.hasVideo ? 'mp4' : 'm4a'}`)
  try { await access(target); return target } catch { /* cache miss */ }
  if (pending.has(key)) return pending.get(key)!
  const work = (async () => {
    await mkdir(cacheDirectory, { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await new Promise<void>((resolve, reject) => {
        const args = ['-v', 'error', '-nostdin', '-i', media.path]
        if (media.hasVideo) args.push('-map', '0:v:0', '-c:v', 'copy')
        args.push('-map', `0:${streamIndex}`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', temporary)
        const child = spawn(ffmpegPath, args, { windowsHide: true })
        registerTask(`preview-${randomUUID()}`, child)
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000) })
        child.once('error', reject)
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`所选音轨预览准备失败：${stderr}`)))
      })
      await rename(temporary, target)
      return target
    } finally { await rm(temporary, { force: true }).catch(() => undefined) }
  })()
  pending.set(key, work)
  try { return await work } finally { pending.delete(key) }
}
